
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const axios = require('axios');
const Papa = require('papaparse');

setGlobalOptions({ region: 'us-central1' });

admin.initializeApp();
const db = admin.firestore();

/**
 * Lógica central de importação.
 */
async function performSync() {
    console.log(">>> [LOG] Iniciando performSync no Servidor...");
    const eventsSnapshot = await db.collection('events').get();
    let totalProcessedSources = 0;

    for (const eventDoc of eventsSnapshot.docs) {
        const eventId = eventDoc.id;
        const eventName = eventDoc.data().name || 'Sem Nome';

        const importRef = db.doc(`events/${eventId}/settings/import_v2`);
        const importSnap = await importRef.get();
        
        if (!importSnap.exists) {
            continue;
        }
        
        const data = importSnap.data() || {};
        
        // VERIFICAÇÃO DO SWITCH GLOBAL
        if (data.globalAutoImportEnabled === false) {
            console.log(`>>> [LOG] Evento ${eventName}: Auto-Import desativado globalmente.`);
            continue;
        }

        const sources = data.sources || [];
        const autoSources = sources.filter(s => s.autoImport);

        if (autoSources.length === 0) continue;

        console.log(`>>> [LOG] Evento ${eventName}: ${autoSources.length} fontes para processar.`);

        // Carrega tickets existentes (apenas IDs para economia de memória)
        const ticketsSnapshot = await db.collection(`events/${eventId}/tickets`).get();
        const existingIds = new Set();
        const ticketsMap = new Map();
        
        ticketsSnapshot.forEach(doc => {
            const id = String(doc.id).trim();
            existingIds.add(id);
            ticketsMap.set(id, doc.data());
        });

        for (const source of autoSources) {
            totalProcessedSources++;
            
            let newItems = 0;
            let updatedCount = 0;
            let existingCount = 0;
            let totalFetched = 0;
            const sectorsAffected = {};
            const ticketsToSave = [];

            try {
                let items = [];

                if (source.type === 'google_sheets') {
                    let fetchUrl = source.url.trim();
                    if (fetchUrl.includes('/edit')) fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                    const response = await axios.get(fetchUrl);
                    const csvData = Papa.parse(response.data, { header: true, skipEmptyLines: true });
                    items = csvData.data.map(row => ({
                        code: row.code || row.codigo || row.id,
                        sector: row.sector || row.setor || 'Geral',
                        name: row.name || row.nome || 'Importado',
                        email: row.email || '',
                        phone: row.phone || row.telefone || '',
                        document: row.document || row.cpf || ''
                    }));
                } else {
                    const endpoint = source.type === 'checkins' ? 'checkins' : 
                                    source.type === 'participants' ? 'participants' :
                                    source.type === 'buyers' ? 'buyers' : 'tickets';
                    
                    const baseUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
                    const cleanToken = source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}`;

                    // SUPORTE A PAGINAÇÃO (MAX 500 itens por página)
                    let currentPage = 1;
                    let hasMore = true;

                    while (hasMore) {
                        console.log(`>>> [LOG] Buscando página ${currentPage} da fonte ${source.name}`);
                        const response = await axios.get(`${baseUrl}/${endpoint}`, {
                            params: { 
                                event_id: source.externalEventId, 
                                per_page: 500,
                                page: currentPage
                            },
                            headers: { 'Authorization': cleanToken }
                        });

                        const responseData = response.data;
                        const itemsRaw = responseData.data || responseData.participants || responseData.tickets || responseData.checkins || responseData.buyers || (Array.isArray(responseData) ? responseData : []);
                        
                        if (!itemsRaw || itemsRaw.length === 0) {
                            hasMore = false;
                            break;
                        }

                        const mappedPage = itemsRaw.map(item => ({
                            code: item.access_code || item.code || item.qr_code || item.barcode || item.id,
                            sector: item.sector_name || item.category?.name || item.category || item.sector || item.ticket_type?.name || 'Geral',
                            name: item.name || item.customer_name || item.buyer_name || (item.customer && item.customer.name) || 'Importado',
                            email: item.email || (item.customer && item.customer.email) || '',
                            phone: item.phone || item.mobile || (item.customer && item.customer.phone) || '',
                            document: item.document || item.cpf || (item.customer && item.customer.document) || '',
                            used: source.type === 'checkins' || item.used === true || item.status === 'used' || item.status === 'validated' || !!item.validated_at,
                            usedAt: item.validated_at || null
                        }));

                        items = items.concat(mappedPage);
                        totalFetched += mappedPage.length;

                        // Verifica se há mais páginas
                        const lastPage = responseData.last_page || responseData.meta?.last_page || responseData.pagination?.total_pages || 1;
                        if (currentPage >= lastPage) {
                            hasMore = false;
                        } else {
                            currentPage++;
                        }
                        
                        // Proteção contra loop infinito em bases gigantes no Cloud Function (limite 50 páginas por execução)
                        if (currentPage > 50) hasMore = false;
                    }
                }

                for (const item of items) {
                    const code = String(item.code || '').trim();
                    if (!code) continue;

                    const isNew = !existingIds.has(code);
                    const sector = String(item.sector || 'Geral').trim();

                    if (isNew) {
                        ticketsToSave.push({
                            id: code,
                            sector: sector,
                            status: item.used ? 'USED' : 'AVAILABLE',
                            usedAt: item.used ? (item.usedAt || Date.now()) : null,
                            source: 'cloud_sync',
                            details: {
                                ownerName: item.name,
                                email: item.email,
                                phone: item.phone,
                                document: item.document
                            }
                        });
                        newItems++;
                        existingIds.add(code);
                        sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                    } else if (item.used) {
                        const existing = ticketsMap.get(code);
                        if (existing && existing.status !== 'USED') {
                            ticketsToSave.push({
                                ...existing,
                                status: 'USED',
                                usedAt: item.usedAt || Date.now()
                            });
                            updatedCount++;
                            sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                        } else {
                            existingCount++;
                        }
                    } else {
                        existingCount++;
                    }
                }

                if (ticketsToSave.length > 0) {
                    const BATCH_SIZE = 400;
                    for (let i = 0; i < ticketsToSave.length; i += BATCH_SIZE) {
                        const batch = db.batch();
                        const chunk = ticketsToSave.slice(i, i + BATCH_SIZE);
                        chunk.forEach(t => {
                            batch.set(db.doc(`events/${eventId}/tickets/${t.id}`), t, { merge: true });
                        });
                        await batch.commit();
                    }
                }

                // --- SEMPRE GERA LOG PARA O CLOUD SYNC ---
                await db.collection(`events/${eventId}/import_logs`).add({
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    sourceName: source.name,
                    newCount: newItems,
                    existingCount,
                    updatedCount,
                    sectorsAffected,
                    status: 'success',
                    type: 'cloud'
                });

                const updatedSources = sources.map(s => 
                    s.id === source.id ? { ...s, lastImportTime: Date.now() } : s
                );
                await importRef.update({ sources: updatedSources });

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
    console.log(">>> [LOG] Fim do ciclo de sincronização.");
    return { success: true, processed: totalProcessedSources };
}

/**
 * Função Agendada (A cada 1 minuto)
 */
exports.syncTicketsScheduled = onSchedule('every 1 minutes', async (event) => {
    return await performSync();
});

/**
 * Função Manual para acionar Cloud
 */
exports.manualTriggerSync = onCall(async (request) => {
    try {
        return await performSync();
    } catch (e) {
        throw new Error(e.message);
    }
});
