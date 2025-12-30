
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const Papa = require('papaparse');

admin.initializeApp();
const db = admin.firestore();

/**
 * Cloud Function agendada para rodar a cada 5 minutos.
 * Percorre todos os eventos e processa as fontes com 'autoImport' ativo.
 */
exports.scheduledAutoImport = functions.pubsub.schedule('every 5 minutes').onRun(async (context) => {
    const eventsSnapshot = await db.collection('events').get();
    
    for (const eventDoc of eventsSnapshot.docs) {
        const eventId = eventDoc.id;
        const eventName = eventDoc.data().name;

        // 1. Carregar fontes de importação
        const importRef = db.doc(`events/${eventId}/settings/import_v2`);
        const importSnap = await importRef.get();
        
        if (!importSnap.exists()) continue;
        const sources = importSnap.data().sources || [];
        const autoSources = sources.filter(s => s.autoImport);

        if (autoSources.length === 0) continue;

        // 2. Carregar tickets existentes para comparação
        const ticketsSnapshot = await db.collection(`events/${eventId}/tickets`).get();
        const existingIds = new Set();
        const ticketsMap = new Map();
        
        ticketsSnapshot.forEach(doc => {
            existingIds.add(doc.id);
            ticketsMap.set(doc.id, doc.data());
        });

        for (const source of autoSources) {
            console.log(`[${eventName}] Iniciando importação da fonte: ${source.name}`);
            
            let newItems = 0;
            let updatedCount = 0;
            let existingCount = 0;
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
                    const response = await axios.get(`${baseUrl}/${endpoint}`, {
                        params: { event_id: source.externalEventId, per_page: 500 },
                        headers: { 'Authorization': source.token.startsWith('Bearer ') ? source.token : `Bearer ${source.token}` }
                    });

                    const data = response.data.data || response.data.participants || response.data.tickets || response.data.checkins || response.data.buyers || (Array.isArray(response.data) ? response.data : []);
                    
                    items = data.map(item => ({
                        code: item.access_code || item.code || item.qr_code || item.id,
                        sector: item.sector_name || item.category?.name || item.category || item.sector || 'Geral',
                        name: item.name || item.customer_name || 'Importado',
                        email: item.email || '',
                        phone: item.phone || '',
                        document: item.document || item.cpf || '',
                        used: source.type === 'checkins' || item.used === true || !!item.validated_at,
                        usedAt: item.validated_at || null
                    }));
                }

                // 3. Processar itens
                for (const item of items) {
                    const code = String(item.code || '').trim();
                    if (!code) continue;

                    const isNew = !existingIds.has(code);
                    const sector = item.sector || 'Geral';

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

                // 4. Salvar em lotes (Batch)
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

                // 5. Registrar Log
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

            } catch (err) {
                console.error(`Erro ao processar fonte ${source.name} do evento ${eventName}:`, err);
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
