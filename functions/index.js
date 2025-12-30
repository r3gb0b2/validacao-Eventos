
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const axios = require('axios');
const Papa = require('papaparse');

setGlobalOptions({ 
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300 
});

admin.initializeApp();
const db = admin.firestore();

/**
 * Lógica central de importação com Paging Reverso e db.getAll
 */
async function performSync() {
    console.log(">>> [LOG] Iniciando ciclo de sincronização otimizado...");
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

        for (const source of autoSources) {
            totalProcessedSources++;
            let newItems = 0;
            let updatedCount = 0;
            let existingCount = 0;
            const sectorsAffected = {};

            try {
                let rawItems = [];
                const cleanToken = source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}`;
                const baseUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
                const endpoint = source.type === 'checkins' ? 'checkins' : 
                                source.type === 'participants' ? 'participants' :
                                source.type === 'buyers' ? 'buyers' : 'tickets';

                if (source.type === 'google_sheets') {
                    // Google Sheets é flat, não tem páginas
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
                    // 1. Descobrir quantas páginas existem (Busca a página 1)
                    const params = { per_page: 100, page: 1 };
                    if (source.externalEventId) params.event_id = source.externalEventId;

                    const firstRes = await axios.get(`${baseUrl}/${endpoint}`, {
                        params,
                        headers: { 'Authorization': cleanToken, 'Accept': 'application/json' }
                    });

                    const resBody = firstRes.data;
                    const lastPage = resBody.last_page || resBody.meta?.last_page || resBody.pagination?.total_pages || 1;
                    
                    // 2. Busca REVERSA (Das últimas páginas para a primeira)
                    // Novos ingressos costumam estar no final da lista da API
                    let pagesToScan = [];
                    const maxPages = 30; // Limite de 3000 itens por rodada
                    for (let p = lastPage; p >= 1 && pagesToScan.length < maxPages; p--) {
                        pagesToScan.push(p);
                    }

                    console.log(`>>> [LOG] Fonte ${source.name}: Varrendo ${pagesToScan.length} páginas de trás para frente (Total: ${lastPage})`);

                    for (const pageNum of pagesToScan) {
                        const pageRes = await axios.get(`${baseUrl}/${endpoint}`, {
                            params: { ...params, page: pageNum },
                            headers: { 'Authorization': cleanToken, 'Accept': 'application/json' },
                            timeout: 8000
                        });
                        const items = pageRes.data.data || pageRes.data.participants || pageRes.data.tickets || pageRes.data.checkins || pageRes.data.buyers || [];
                        rawItems = rawItems.concat(items);
                        if (items.length === 0) break;
                    }
                }

                // 3. Processamento OTIMIZADO com db.getAll
                const batchSize = 400;
                for (let i = 0; i < rawItems.length; i += batchSize) {
                    const chunk = rawItems.slice(i, i + batchSize);
                    
                    // Prepara referências para busca em lote
                    const refs = chunk.map(item => {
                        const code = String(item.access_code || item.code || item.qr_code || item.barcode || item.id || '').trim();
                        return code ? db.doc(`events/${eventId}/tickets/${code}`) : null;
                    }).filter(r => r !== null);

                    if (refs.length === 0) continue;

                    // BUSCA EM LOTE (Muito mais rápido que um por um)
                    const snapshots = await db.getAll(...refs);
                    const batch = db.batch();
                    let batchChanges = 0;

                    for (let j = 0; j < snapshots.length; j++) {
                        const ticketSnap = snapshots[j];
                        const item = chunk[j];
                        const code = ticketSnap.id;

                        let rawSector = 'Geral';
                        if (item.sector_name) rawSector = item.sector_name;
                        else if (item.category?.name) rawSector = item.category.name;
                        else if (item.category) rawSector = item.category;
                        else if (item.sector) rawSector = item.sector;
                        else if (item.ticket_type?.name) rawSector = item.ticket_type.name;
                        const sector = String(rawSector).trim() || 'Geral';

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
                                    document: item.document || item.cpf || (item.customer && item.customer.document) || ''
                                }
                            });
                            newItems++;
                            batchChanges++;
                            sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                        } else if (shouldMarkUsed) {
                            const currentData = ticketSnap.data();
                            if (currentData.status !== 'USED') {
                                batch.update(ticketSnap.ref, {
                                    status: 'USED',
                                    usedAt: item.validated_at || Date.now()
                                });
                                updatedCount++;
                                batchChanges++;
                                sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                            } else {
                                existingCount++;
                            }
                        } else {
                            existingCount++;
                        }
                    }

                    if (batchChanges > 0) {
                        await batch.commit();
                    }
                }

                await db.collection(`events/${eventId}/import_logs`).add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    sourceName: source.name,
                    newCount: newItems,
                    existingCount: existingCount,
                    updatedCount: updatedCount,
                    sectorsAffected: sectorsAffected,
                    status: 'success',
                    type: 'cloud'
                });

                await importRef.update({ 
                    [`source_last_sync_${source.id}`]: Date.now() 
                });

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
