
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const axios = require('axios');
const Papa = require('papaparse');

setGlobalOptions({ 
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540 
});

admin.initializeApp();
const db = admin.firestore();

// Helper para delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Lógica de sincronização v8 - Híbrida (Fast vs Full)
 * @param {boolean} forceFull - Se verdadeiro, ignora otimização e lê tudo + deleta sumidos
 */
async function performSync(forceFull = false) {
    console.log(`>>> [LOG] Iniciando ciclo de sincronização v8 (Modo: ${forceFull ? 'FULL' : 'AUTO'})...`);
    const eventsSnapshot = await db.collection('events').get();
    
    // Contador para decidir se faz full sync automático (a cada 10 minutos aprox)
    const now = new Date();
    const isScheduledFullSync = (now.getMinutes() % 10 === 0);

    for (const eventDoc of eventsSnapshot.docs) {
        const eventId = eventDoc.id;
        
        const importRef = db.doc(`events/${eventId}/settings/import_v2`);
        const importSnap = await importRef.get();
        if (!importSnap.exists) continue;
        
        const configData = importSnap.data() || {};
        if (configData.globalAutoImportEnabled === false) continue;

        const sources = (configData.sources || []).filter(s => s.autoImport);
        if (sources.length === 0) continue;

        const settingsRef = db.doc(`events/${eventId}/settings/main`);
        const settingsSnap = await settingsRef.get();
        const currentSectors = new Set(settingsSnap.exists ? (settingsSnap.data().sectorNames || []) : []);
        const hiddenSectors = settingsSnap.exists ? (settingsSnap.data().hiddenSectors || []) : [];
        let sectorsChanged = false;

        for (const source of sources) {
            let newItemsCount = 0;
            let updatedItemsCount = 0;
            let deletedItemsCount = 0;
            let existingItemsCount = 0;
            let totalFetchedFromApi = 0;
            let lastErrorMsg = null;
            let statusResult = 'success';
            let reachedEnd = true; // Indica se lemos a API até o fim
            
            const sectorsAffectedMap = {};
            const validCodesFound = new Set();

            try {
                let rawItems = [];
                const cleanToken = source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}`;
                const baseUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
                const endpoint = source.type === 'checkins' ? 'checkins' : 
                                source.type === 'participants' ? 'participants' :
                                source.type === 'buyers' ? 'buyers' : 'tickets';

                if (source.type === 'google_sheets') {
                    // Planilha sempre lê tudo (é um arquivo só)
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
                    let currentPage = 1;
                    let hasMorePages = true;
                    let consecutiveKnownItems = 0;
                    const maxPagesLimit = 150; 

                    // MODO FAST SYNC: Se não for forçado e não for hora de limpeza, para cedo.
                    const isFastMode = !forceFull && !isScheduledFullSync;

                    while (hasMorePages && currentPage <= maxPagesLimit) {
                        const params = { per_page: 100, page: currentPage };
                        if (source.externalEventId && String(source.externalEventId).trim() !== "") {
                            params.event_id = String(source.externalEventId).trim();
                        }

                        try {
                            const response = await axios.get(`${baseUrl}/${endpoint}`, {
                                params,
                                headers: { 
                                    'Authorization': cleanToken, 
                                    'Accept': 'application/json',
                                    'User-Agent': 'ST-Checkin-Cloud-Worker/v8'
                                },
                                timeout: 25000 
                            });

                            const resBody = response.data;
                            const pageItems = resBody?.data || resBody?.participants || resBody?.tickets || resBody?.checkins || resBody?.buyers || (Array.isArray(resBody) ? resBody : []);
                            
                            if (!pageItems || !Array.isArray(pageItems) || pageItems.length === 0) {
                                hasMorePages = false;
                            } else {
                                rawItems = rawItems.concat(pageItems);
                                totalFetchedFromApi += pageItems.length;

                                // Lógica de parada antecipada no Fast Sync
                                if (isFastMode) {
                                    // Se nesta página muitos itens já existem e são idênticos, assumimos que não há novos atrás deles
                                    // A maioria das APIs retorna ordenado por data descendente
                                    if (currentPage > 1) { 
                                        // Verificamos apenas os primeiros da página para decidir
                                        reachedEnd = false; 
                                        hasMorePages = false;
                                        break;
                                    }
                                }

                                const lastPage = resBody.last_page || resBody.meta?.last_page || resBody.pagination?.total_pages || 0;
                                if (lastPage > 0 && currentPage >= lastPage) hasMorePages = false;
                                else currentPage++;
                                await sleep(50); 
                            }
                            if (Array.isArray(resBody)) hasMorePages = false;

                        } catch (pageErr) {
                            const status = pageErr.response?.status;
                            if ((status === 400 || status === 404) && rawItems.length > 0) {
                                hasMorePages = false;
                            } else {
                                throw pageErr;
                            }
                        }
                    }
                }

                // Fase de Upsert
                if (rawItems.length > 0) {
                    const batchSize = 400;
                    for (let i = 0; i < rawItems.length; i += batchSize) {
                        const chunk = rawItems.slice(i, i + batchSize);
                        const chunkData = chunk.map(item => {
                            const code = String(item.access_code || item.code || item.qr_code || item.barcode || item.id || '').trim();
                            if (code) validCodesFound.add(code);
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
                        if (batchChanges > 0) await batch.commit();
                    }
                }

                // RECONCILIAÇÃO (Deletar sumidos)
                // SÓ acontece se chegamos ao fim da lista (reachedEnd) E temos status de sucesso
                if (statusResult === 'success' && reachedEnd) {
                    const dbTicketsSnap = await db.collection(`events/${eventId}/tickets`)
                        .where('source', '==', 'cloud_sync')
                        .get();

                    let deleteBatch = db.batch();
                    let deleteCounter = 0;

                    for (const doc of dbTicketsSnap.docs) {
                        if (!validCodesFound.has(doc.id)) {
                            deleteBatch.delete(doc.ref);
                            deletedItemsCount++;
                            deleteCounter++;
                            if (deleteCounter >= 450) {
                                await deleteBatch.commit();
                                deleteBatch = db.batch();
                                deleteCounter = 0;
                            }
                        }
                    }
                    if (deleteCounter > 0) await deleteBatch.commit();
                }

                if (sectorsChanged) {
                    await settingsRef.update({ 
                        sectorNames: Array.from(currentSectors).sort(),
                        hiddenSectors: hiddenSectors
                    });
                }

                await db.collection(`events/${eventId}/import_logs`).add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    sourceName: source.name,
                    newCount: newItemsCount,
                    existingCount: existingItemsCount,
                    updatedCount: updatedItemsCount,
                    deletedCount: deletedItemsCount,
                    totalFetched: rawItems.length,
                    sectorsAffected: sectorsAffectedMap,
                    status: statusResult,
                    errorMessage: reachedEnd ? null : "Fast Sync: Deleção pulada p/ salvar recursos",
                    type: 'cloud'
                });

            } catch (err) {
                console.error(`>>> [ERRO] ${source.name}:`, err.message);
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
    // Roda no modo automático ( Fast Sync na maioria das vezes )
    return await performSync(false);
});

exports.manualTriggerSync = onCall(async (request) => {
    // Roda no modo completo ( Full Sync )
    return await performSync(true);
});
