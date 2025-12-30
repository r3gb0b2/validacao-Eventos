
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const axios = require('axios');
const Papa = require('papaparse');

setGlobalOptions({ 
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300 // Aumentado para 5 minutos para lidar com grandes volumes
});

admin.initializeApp();
const db = admin.firestore();

/**
 * Lógica central de importação.
 */
async function performSync() {
    console.log(">>> [LOG] Iniciando ciclo de sincronização...");
    const eventsSnapshot = await db.collection('events').get();
    let totalProcessedSources = 0;

    for (const eventDoc of eventsSnapshot.docs) {
        const eventId = eventDoc.id;
        const eventData = eventDoc.data();
        const eventName = eventData.name || 'Sem Nome';

        // Tenta pegar as configurações de importação
        const importRef = db.doc(`events/${eventId}/settings/import_v2`);
        const importSnap = await importRef.get();
        
        if (!importSnap.exists) continue;
        
        const configData = importSnap.data() || {};
        
        // Verifica se o auto-import está ligado para este evento
        if (configData.globalAutoImportEnabled === false) {
            console.log(`>>> [LOG] Evento ${eventName}: Auto-import desligado.`);
            continue;
        }

        const sources = configData.sources || [];
        const autoSources = sources.filter(s => s.autoImport);

        if (autoSources.length === 0) continue;

        console.log(`>>> [LOG] Evento ${eventName}: Processando ${autoSources.length} fontes.`);

        for (const source of autoSources) {
            totalProcessedSources++;
            
            let newItems = 0;
            let updatedCount = 0;
            let existingCount = 0;
            let totalFetched = 0;
            const sectorsAffected = {};

            try {
                let rawItems = [];

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
                        phone: row.phone || row.telefone || '',
                        document: row.document || row.cpf || ''
                    }));
                } else {
                    const endpoint = source.type === 'checkins' ? 'checkins' : 
                                    source.type === 'participants' ? 'participants' :
                                    source.type === 'buyers' ? 'buyers' : 'tickets';
                    
                    const baseUrl = source.url.endsWith('/') ? source.url.slice(0, -1) : source.url;
                    const cleanToken = source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}`;

                    let currentPage = 1;
                    let hasMore = true;

                    // Busca paginada (limite de segurança de 20 páginas por fonte em cada rodada de 1 min)
                    while (hasMore && currentPage <= 20) {
                        const params = { per_page: 100, page: currentPage };
                        if (source.externalEventId) params.event_id = source.externalEventId;

                        const response = await axios.get(`${baseUrl}/${endpoint}`, {
                            params,
                            headers: { 'Authorization': cleanToken, 'Accept': 'application/json' },
                            timeout: 10000 // 10s timeout por request
                        });

                        const resBody = response.data;
                        const pageItems = resBody.data || resBody.participants || resBody.tickets || resBody.checkins || resBody.buyers || (Array.isArray(resBody) ? resBody : []);
                        
                        if (!pageItems || pageItems.length === 0) {
                            hasMore = false;
                        } else {
                            rawItems = rawItems.concat(pageItems);
                            const lastPage = resBody.last_page || resBody.meta?.last_page || resBody.pagination?.total_pages || 1;
                            if (currentPage >= lastPage) hasMore = false;
                            else currentPage++;
                        }
                    }
                }

                totalFetched = rawItems.length;
                console.log(`>>> [LOG] Fonte ${source.name}: ${totalFetched} itens recuperados da API.`);

                // Processamento em lotes para evitar sobrecarga
                const batchSize = 400;
                for (let i = 0; i < rawItems.length; i += batchSize) {
                    const chunk = rawItems.slice(i, i + batchSize);
                    const batch = db.batch();
                    let batchChanges = 0;

                    // Para cada item no chunk, verificamos no Firestore se existe
                    // OTIMIZAÇÃO: Usamos o ID do documento para verificar existência sem baixar a coleção inteira
                    for (const item of chunk) {
                        const code = String(item.access_code || item.code || item.qr_code || item.barcode || item.id || '').trim();
                        if (!code) continue;

                        const ticketRef = db.doc(`events/${eventId}/tickets/${code}`);
                        const ticketSnap = await ticketRef.get();
                        
                        let rawSector = 'Geral';
                        if (item.sector_name) rawSector = item.sector_name;
                        else if (item.category?.name) rawSector = item.category.name;
                        else if (item.category) rawSector = item.category;
                        else if (item.sector) rawSector = item.sector;
                        else if (item.ticket_type?.name) rawSector = item.ticket_type.name;
                        const sector = String(rawSector).trim() || 'Geral';

                        const shouldMarkUsed = source.type === 'checkins' || item.used === true || item.status === 'used' || item.status === 'validated' || !!item.validated_at;

                        if (!ticketSnap.exists) {
                            // Ticket Novo
                            batch.set(ticketRef, {
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
                        } else {
                            // Ticket já existe - verifica se precisa atualizar check-in
                            const currentData = ticketSnap.data();
                            if (shouldMarkUsed && currentData.status !== 'USED') {
                                batch.update(ticketRef, {
                                    status: 'USED',
                                    usedAt: item.validated_at || Date.now()
                                });
                                updatedCount++;
                                batchChanges++;
                                sectorsAffected[sector] = (sectorsAffected[sector] || 0) + 1;
                            } else {
                                existingCount++;
                            }
                        }
                    }

                    if (batchChanges > 0) {
                        await batch.commit();
                    }
                }

                // --- SEMPRE GERA LOG, mesmo que 0 itens novos ---
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

                // Atualiza o horário da última importação na configuração da fonte
                const currentSources = (await importRef.get()).data().sources || [];
                const updatedSources = currentSources.map(s => 
                    s.id === source.id ? { ...s, lastImportTime: Date.now() } : s
                );
                await importRef.update({ sources: updatedSources });

                console.log(`>>> [LOG] Fonte ${source.name} finalizada: ${newItems} novos, ${updatedCount} atualizados.`);

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

    return { success: true, processed: totalProcessedSources };
}

exports.syncTicketsScheduled = onSchedule('every 1 minutes', async (event) => {
    return await performSync();
});

exports.manualTriggerSync = onCall(async (request) => {
    return await performSync();
});
