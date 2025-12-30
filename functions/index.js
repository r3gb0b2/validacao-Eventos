
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const axios = require('axios');
const Papa = require('papaparse');

// Define a região padrão
setGlobalOptions({ region: 'us-central1' });

admin.initializeApp();
const db = admin.firestore();

/**
 * Função Renomeada para evitar erro de upgrade de geração do Firebase.
 * Roda a cada 5 minutos.
 */
exports.syncTicketsScheduled = onSchedule('every 5 minutes', async (event) => {
    console.log("Iniciando ciclo de auto-importação...");
    
    const eventsSnapshot = await db.collection('events').get();
    
    for (const eventDoc of eventsSnapshot.docs) {
        const eventId = eventDoc.id;
        const eventData = eventDoc.data();
        const eventName = eventData.name || 'Sem Nome';

        // 1. Carregar configurações de importação
        const importRef = db.doc(`events/${eventId}/settings/import_v2`);
        const importSnap = await importRef.get();
        
        // CORREÇÃO: exists é uma propriedade booleana no Admin SDK
        if (!importSnap.exists) continue;
        
        const sources = importSnap.data().sources || [];
        const autoSources = sources.filter(s => s.autoImport);

        if (autoSources.length === 0) continue;

        // 2. Carregar IDs existentes para evitar duplicatas e processar check-ins
        const ticketsSnapshot = await db.collection(`events/${eventId}/tickets`).get();
        const existingIds = new Set();
        const ticketsMap = new Map();
        
        ticketsSnapshot.forEach(doc => {
            const id = String(doc.id).trim();
            existingIds.add(id);
            ticketsMap.set(id, doc.data());
        });

        for (const source of autoSources) {
            console.log(`[${eventName}] Processando fonte: ${source.name}`);
            
            let newItems = 0;
            let updatedCount = 0;
            let existingCount = 0;
            const sectorsAffected = {};
            const ticketsToSave = [];

            try {
                let items = [];

                if (source.type === 'google_sheets') {
                    let fetchUrl = source.url.trim();
                    if (fetchUrl.includes('/edit')) {
                        fetchUrl = fetchUrl.split('/edit')[0] + '/export?format=csv';
                    }
                    
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

                    const response = await axios.get(`${baseUrl}/${endpoint}`, {
                        params: { 
                            event_id: source.externalEventId, 
                            per_page: 500 
                        },
                        headers: { 'Authorization': cleanToken }
                    });

                    const responseData = response.data;
                    const itemsRaw = responseData.data || responseData.participants || responseData.tickets || responseData.checkins || responseData.buyers || (Array.isArray(responseData) ? responseData : []);
                    
                    items = itemsRaw.map(item => ({
                        code: item.access_code || item.code || item.qr_code || item.barcode || item.id,
                        sector: item.sector_name || item.category?.name || item.category || item.sector || item.ticket_type?.name || 'Geral',
                        name: item.name || item.customer_name || item.buyer_name || (item.customer && item.customer.name) || 'Importado',
                        email: item.email || (item.customer && item.customer.email) || '',
                        phone: item.phone || item.mobile || (item.customer && item.customer.phone) || '',
                        document: item.document || item.cpf || (item.customer && item.customer.document) || '',
                        used: source.type === 'checkins' || item.used === true || item.status === 'used' || item.status === 'validated' || !!item.validated_at,
                        usedAt: item.validated_at || null
                    }));
                }

                // 3. Cruzamento de dados
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

                // 4. Gravação em Batch (Lotes)
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

                // 5. Registrar Log e Atualizar Timestamp
                if (newItems > 0 || updatedCount > 0) {
                    await db.collection(`events/${eventId}/import_logs`).add({
                        timestamp: Date.now(),
                        sourceName: source.name,
                        newCount: newItems,
                        existingCount,
                        updatedCount,
                        sectorsAffected,
                        status: 'success'
                    });
                }

                const updatedSources = sources.map(s => 
                    s.id === source.id ? { ...s, lastImportTime: Date.now() } : s
                );
                await importRef.update({ sources: updatedSources });

            } catch (err) {
                console.error(`Erro na fonte ${source.name}:`, err.message);
                await db.collection(`events/${eventId}/import_logs`).add({
                    timestamp: Date.now(),
                    sourceName: source.name,
                    status: 'error',
                    errorMessage: err.message
                });
            }
        }
    }
    return null;
});
