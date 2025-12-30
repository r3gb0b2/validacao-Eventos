
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const axios = require('axios');
const Papa = require('papaparse');

setGlobalOptions({ 
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540 // Aumentado para 9 minutos (limite máximo recomendado)
});

admin.initializeApp();
const db = admin.firestore();

/**
 * Lógica de sincronização robusta (v4)
 * Replica exatamente o comportamento da importação manual que funciona no navegador.
 */
async function performSync() {
    console.log(">>> [LOG] Iniciando ciclo de sincronização v4...");
    const eventsSnapshot = await db.collection('events').get();
    let totalProcessedSources = 0;

    for (const eventDoc of eventsSnapshot.docs) {
        const eventId = eventDoc.id;
        const eventData = eventDoc.data();
        const eventName = eventData.name || 'Sem Nome';

        const importRef = db.doc(`events/${eventId}/settings/import_v2`);
        const importSnap = await importRef.get();
        if (!importSnap.exists) continue;
        
        const configData = importSnap.data() || {};
        if (configData.globalAutoImportEnabled === false) continue;

        const sources = configData.sources || [];
        const autoSources = sources.filter(s => s.autoImport);
        if (autoSources.length === 0) continue;

        // Carrega configurações de setores
        const settingsRef = db.doc(`events/${eventId}/settings/main`);
        const settingsSnap = await settingsRef.get();
        const currentSectors = new Set(settingsSnap.exists ? (settingsSnap.data().sectorNames || []) : []);
        const hiddenSectors = settingsSnap.exists ? (settingsSnap.data().hiddenSectors || []) : [];
        let sectorsChanged = false;

        for (const source of autoSources) {
            totalProcessedSources++;
            let newItemsCount = 0;
            let updatedItemsCount = 0;
            let existingItemsCount = 0;
            let totalFetchedFromApi = 0;
            const sectorsAffectedMap = {};

            try {
                let rawItems = [];
                const cleanToken = source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}`;
                const baseUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
                const endpoint = source.type === 'checkins' ? 'checkins' : 
                                source.type === 'participants' ? 'participants' :
                                source.type === 'buyers' ? 'buyers' : 'tickets';

                if (source.type === 'google_sheets') {
                    let fetchUrl = source.url.trim();
                    if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                    const response = await axios.get(fetchUrl);
                    const csvData = Papa.parse(response.data, { header: true, skipEmptyLines: true });
                    rawItems = csvData.data.map(row => ({
                        code: String(row.code || row.codigo || row.id || '').trim(),
                        sector: String(row.sector || row.setor || 'Geral').trim(),
                        name: String(row.name || row.nome || 'Importado').trim(),
                        email: row.email || '',
                        document: row.document || row.cpf || ''
                    }));
                } else {
                    // PAGINAÇÃO PROGRESSIVA (Igual ao Manual)
                    let currentPage = 1;
                    let hasMorePages = true;
                    const maxPagesLimit = 100; // Proteção contra loops infinitos (10.000 registros)

                    while (hasMorePages && currentPage <= maxPagesLimit) {
                        const params = { per_page: 100, page: currentPage };
                        if (source.externalEventId) params.event_id = source.externalEventId;

                        console.log(`>>> [LOG] Buscando ${source.name} - Página ${currentPage}...`);
                        
                        const response = await axios.get(`${baseUrl}/${endpoint}`, {
                            params,
                            headers: { 'Authorization': cleanToken, 'Accept': 'application/json' },
                            timeout: 15000
                        });

                        const resBody = response.data;
                        const pageItems = resBody.data || resBody.participants || resBody.tickets || resBody.checkins || resBody.buyers || (Array.isArray(resBody) ? resBody : []);
                        
                        if (!pageItems || !Array.isArray(pageItems) || pageItems.length === 0) {
                            hasMorePages = false;
                        } else {
                            rawItems = rawItems.concat(pageItems);
                            
                            // Tenta detectar a última página por metadados da API
                            const lastPage = resBody.last_page || resBody.meta?.last_page || resBody.pagination?.total_pages || 0;
                            
                            if (lastPage > 0 && currentPage >= lastPage) {
                                hasMorePages = false;
                            } else {
                                currentPage++;
                            }
                        }
                        
                        // Se a resposta for um array direto, não há paginação
                        if (Array.isArray(resBody)) hasMorePages = false;
                    }
                }

                totalFetchedFromApi = rawItems.length;
                console.log(`>>> [LOG] Fonte ${source.name}: ${totalFetchedFromApi} itens totais carregados da API.`);

                // PROCESSAMENTO EM LOTES COM DB.GETALL
                const batchSize = 400;
                for (let i = 0; i < rawItems.length; i += batchSize) {
                    const chunk = rawItems.slice(i, i + batchSize);
                    
                    const chunkData = chunk.map(item => {
                        const code = String(item.access_code || item.code || item.qr_code || item.barcode || item.id || '').trim();
                        return code ? { code, item } : null;
                    }).filter(d => d !== null);

                    const refs = chunkData.map(d => db.doc(`events/${eventId}/tickets/${d.code}`));
                    if (refs.length === 0) continue;

                    const snapshots = await db.getAll(...refs);
                    const batch = db.batch();
                    let batchChanges = 0;

                    for (let j = 0; j < snapshots.length; j++) {
                        const ticketSnap = snapshots[j];
                        const item = chunkData[j].item;
                        const code = ticketSnap.id;

                        let rawSector = 'Geral';
                        if (item.sector_name) rawSector = item.sector_name;
                        else if (item.category?.name) rawSector = item.category.name;
                        else if (item.category) rawSector = item.category;
                        else if (item.sector) rawSector = item.sector;
                        else if (item.ticket_type?.name) rawSector = item.ticket_type.name;
                        const sector = String(rawSector).trim() || 'Geral';

                        if (!currentSectors.has(sector)) {
                            currentSectors.add(sector);
                            sectorsChanged = true;
                        }

                        const shouldMarkUsed = source.type === 'checkins' || item.used === true || item.status === 'used' || item.status === 'validated' || !!item.validated_at;

                        if (!ticketSnap.exists) {
                            batch.set(ticketSnap.ref, {
                                id: code,
                                sector: sector,
                                status: shouldMarkUsed ? 'USED' : 'AVAILABLE',
                                usedAt: shouldMarkUsed ? (item.validated_at || Date.now()) : null,
                                source: 'cloud_sync',
                                details: {
                                    ownerName: String(item.name || item.customer_name || item.buyer_name || (item.customer && item.customer.name) || 'Importado').trim(),
                                    email: item.email || (item.customer && item.customer.email) || '',
                                    phone: item.phone || item.mobile || (item.customer && item.customer.phone) || '',
                                    document: item.document || item.cpf || (item.customer && item.customer.document) || '',
                                    originalId: item.id || null
                                }
                            });
                            newItemsCount++;
                            batchChanges++;
                            sectorsAffectedMap[sector] = (sectorsAffectedMap[sector] || 0) + 1;
                        } else {
                            const currentData = ticketSnap.data();
                            if (shouldMarkUsed && currentData.status !== 'USED') {
                                batch.update(ticketSnap.ref, {
                                    status: 'USED',
                                    usedAt: item.validated_at || Date.now()
                                });
                                updatedItemsCount++;
                                batchChanges++;
                                sectorsAffectedMap[sector] = (sectorsAffectedMap[sector] || 0) + 1;
                            } else {
                                existingItemsCount++;
                            }
                        }
                    }

                    if (batchChanges > 0) {
                        await batch.commit();
                    }
                }

                if (sectorsChanged) {
                    await settingsRef.update({ 
                        sectorNames: Array.from(currentSectors).sort(),
                        hiddenSectors: hiddenSectors
                    });
                }

                // REGISTRA LOG DETALHADO
                await db.collection(`events/${eventId}/import_logs`).add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    sourceName: source.name,
                    newCount: newItemsCount,
                    existingCount: existingItemsCount,
                    updatedCount: updatedItemsCount,
                    totalFetched: totalFetchedFromApi, // Campo crucial para depuração
                    sectorsAffected: sectorsAffectedMap,
                    status: 'success',
                    type: 'cloud'
                });

                await importRef.update({ 
                    [`source_last_sync_${source.id}`]: Date.now() 
                });

                console.log(`>>> [LOG] Fonte ${source.name} finalizada. Total: ${totalFetchedFromApi}, Novos: ${newItemsCount}`);

            } catch (err) {
                console.error(`>>> [ERRO] Fonte ${source.name}:`, err.message);
                await db.collection(`events/${eventId}/import_logs`).add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    sourceName: source.name,
                    status: 'error',
                    errorMessage: err.message,
                    type: 'cloud'
                });
            }
        }
    }
    return { success: true };
}

exports.syncTicketsScheduled = onSchedule('every 1 minutes', async (event) => {
    return await performSync();
});

exports.manualTriggerSync = onCall(async (request) => {
    return await performSync();
});
