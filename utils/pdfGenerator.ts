import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Ticket, DisplayableScanLog, ScanStatus } from '../types';

// Helper to translate status for the report
const translateScanStatus = (status: ScanStatus): string => {
    switch (status) {
        case 'VALID': return 'Válido';
        case 'USED': return 'Já Utilizado';
        case 'WRONG_SECTOR': return 'Setor Incorreto';
        case 'INVALID': return 'Inválido';
        case 'ERROR': return 'Erro';
        default: return status;
    }
}

export const generateEventReport = (
    eventName: string,
    allTickets: Ticket[],
    scanHistory: DisplayableScanLog[],
    sectorNames: string[]
) => {
    const doc = new jsPDF();

    // Title
    doc.setFontSize(22);
    doc.text(`Relatório do Evento: ${eventName}`, 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 105, 28, { align: 'center' });

    // --- Statistics Summary ---
    const calculateStats = (filter?: string) => {
        const relevantTickets = filter ? allTickets.filter(t => t.sector === filter) : allTickets;
        return {
            total: relevantTickets.length,
            scanned: relevantTickets.filter(t => t.status === 'USED').length,
        };
    };
    
    const generalStats = calculateStats();
    
    const statsBody = [
        ['Geral', generalStats.total, generalStats.scanned, generalStats.total - generalStats.scanned]
    ];

    sectorNames.forEach(sector => {
        const sectorStats = calculateStats(sector);
        statsBody.push([sector, sectorStats.total, sectorStats.scanned, sectorStats.total - sectorStats.scanned]);
    });

    autoTable(doc, {
        startY: 40,
        head: [['Resumo', 'Total de Ingressos', 'Entradas Válidas', 'Restantes']],
        body: statsBody,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
    });

    // --- Scan History ---
    const scanHistoryBody = scanHistory.map(scan => [
        new Date(scan.timestamp).toLocaleString('pt-BR'),
        scan.ticketId,
        scan.ticketSector,
        translateScanStatus(scan.status)
    ]);

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 15,
        head: [['Horário da Validação', 'ID do Ingresso', 'Setor do Ingresso', 'Status']],
        body: scanHistoryBody,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] },
        didDrawPage: (data) => {
            doc.setFontSize(18);
            doc.text('Histórico de Validações', 14, (data.settings.margin as any).top);
        }
    });

    // --- All Tickets Status ---
    const allTicketsBody = allTickets.map(ticket => [
        ticket.id,
        ticket.sector,
        ticket.status === 'USED' ? 'Utilizado' : 'Disponível',
        ticket.usedAt ? new Date(ticket.usedAt).toLocaleString('pt-BR') : '-'
    ]);

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 15,
        head: [['ID do Ingresso', 'Setor', 'Status Final', 'Horário de Uso']],
        body: allTicketsBody,
        theme: 'striped',
        headStyles: { fillColor: [41, 128, 185] },
        didDrawPage: (data) => {
            doc.setFontSize(18);
            doc.text('Status de Todos os Ingressos', 14, (data.settings.margin as any).top);
        }
    });

    // Save the PDF
    doc.save(`relatorio_${eventName.replace(/ /g, '_')}.pdf`);
};