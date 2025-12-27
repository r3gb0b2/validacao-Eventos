
import jsPDF from 'jspdf';

export interface TicketPdfDetails {
  eventName: string;
  openingTime: string;
  venue: string;
  address: string;
  producer: string;
  contact: string;
  sector: string;
  ownerName: string;
}

export const generateSingleTicketBlob = async (details: TicketPdfDetails) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const generateCode = () => Math.random().toString(36).substring(2, 14).toUpperCase();
  const ticketCode = generateCode();
  const purchaseCode = generateCode();
  
  // Cores Oficiais ST (Ajustadas para fidelidade)
  const orangeSt = [255, 80, 0]; 
  const darkGray = [40, 40, 40];
  const labelGray = [130, 130, 130];

  // --- PÁGINA 1 ---
  
  // Cabeçalho Laranja Vibrante
  doc.setFillColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.rect(10, 10, 190, 120, 'F');

  // --- DESENHO DA LOGO (POLÍGONO FIEL À IMAGEM) ---
  const logoX = 72;
  const logoY = 22;
  
  // Fundo Branco do Ticket
  doc.setFillColor(255, 255, 255);
  // Desenho simplificado do formato do ticket arredondado
  doc.roundedRect(logoX, logoY, 14, 14, 3, 3, 'F');
  
  // Recorte interno Laranja (O formato em 'M' estilizado)
  doc.setFillColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.setLineWidth(0);
  // Parte interna do ticket
  doc.roundedRect(logoX + 2, logoY + 3, 10, 8, 1, 1, 'F');
  
  // Os 3 Pontos Brancos da Logo
  doc.setFillColor(255, 255, 255);
  doc.circle(logoX + 4.5, logoY + 5.5, 0.6, 'F');
  doc.circle(logoX + 7, logoY + 5.5, 0.6, 'F');
  doc.circle(logoX + 9.5, logoY + 5.5, 0.6, 'F');

  // --- TEXTO STingressos ---
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('ST', logoX + 16, logoY + 11.5); // ST em Negrito
  
  doc.setFont('helvetica', 'normal');
  const stWidth = doc.getTextWidth('ST');
  doc.text('ingressos', logoX + 16 + stWidth, logoY + 11.5); // ingressos em Normal

  // Linha pontilhada branca fina
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(20, 45, 190, 45);

  // Cartão de Acesso
  doc.setFontSize(13);
  doc.setFont('helvetica', 'normal');
  doc.text('C A R T Ã O   D E   A C E S S O', 105, 54, { align: 'center' });

  // Nome do Evento (Maiúsculo e Bold)
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.text(details.eventName.toUpperCase(), 105, 70, { align: 'center' });

  // Linha pontilhada branca 2
  doc.line(20, 80, 190, 80);

  // Detalhes do Evento
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Abertura: ${details.openingTime}   Local: ${details.venue}`, 105, 92, { align: 'center' });
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Endereço: ${details.address}`, 105, 100, { align: 'center', maxWidth: 160 });
  
  doc.setFont('helvetica', 'bold');
  doc.text(`Produzido: ${details.producer}   Contato: ${details.contact}`, 105, 112, { align: 'center' });

  // --- ÁREA DE INFORMAÇÕES DO CLIENTE (CINZA ESCURO) ---
  
  // Rótulos (Cinza Médio)
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Ingresso', 15, 145);
  doc.text('Participante', 195, 145, { align: 'right' });
  
  // Dados (Cinza Grafite e Bold)
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(details.sector, 15, 155);
  doc.text(details.ownerName, 195, 155, { align: 'right' });

  // Códigos
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Código da Compra', 15, 170);
  doc.text('Código do ingresso', 195, 170, { align: 'right' });

  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(purchaseCode, 15, 180);
  doc.text(ticketCode, 195, 180, { align: 'right' });

  // Linha divisória
  doc.setDrawColor(220, 220, 220);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(15, 190, 195, 190);

  // QR CODE (Centralizado e Grande)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${ticketCode}`;
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = qrUrl;
  await new Promise((resolve) => {
    img.onload = () => {
      doc.addImage(img, 'PNG', 70, 205, 70, 70);
      resolve(true);
    };
  });

  // --- PÁGINA 2 (TERMOS) ---
  doc.addPage();
  
  doc.setDrawColor(255, 0, 80); 
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([], 0);
  doc.rect(10, 10, 190, 277);

  doc.setTextColor(255, 0, 80);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMAÇÃO IMPORTANTE!', 105, 25, { align: 'center' });

  doc.setFontSize(12);
  const infoText = `Você está recebendo apenas um ingresso da compra ${ticketCode}. Este ingresso estará sujeito a cancelamentos, ou mudanças por parte do comprador. No dia do evento, documentos de identificação pessoal e da compra poderão ser exigidos na entrada do evento. Lembre-se que a forma mais segura de você comprar ingressos é diretamente na nossa plataforma. Caso essa compra fira nossos termos de uso ou a legislação vigente, você poderá ser responsabilizado. Qualquer dúvida leia nossos termos de uso ou entre em contato conosco.`;
  
  doc.text(infoText, 15, 38, { maxWidth: 180, align: 'justify' });

  doc.setTextColor(110, 110, 110);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const terms = `A SeuTickets emitiu este ingresso por força de contrato de prestação de serviço celebrado com o promotor do evento. O mesmo é o único responsável pela realização, cancelamento ou adiamento do evento e/ou espetáculo, bem como pela restituição do valor do ingresso. Seu ingresso e as informações nele contidas são de sua responsabilidade. Não compartilhe fotos nem informações sobre ele com outras pessoas. Qualquer uso por outra pessoa do seu ingresso não será de responsabilidade da SeuTickets. Este ingresso possui itens de segurança e estará sujeito à verificação na portaria do evento. O código de barras contido neste ingresso é único e não se repete, garantindo acesso apenas uma única vez ao evento. A organização do evento reserva-se o direito de solicitar um documento com foto e o cartão utilizado na compra na entrada do evento. Este evento poderá ser gerado, filmado ou fotografado. Ao participar do evento, o portador deste ingresso concorda e autoriza a utilização gratuita de sua imagem por prazo indeterminado. Meia entrada: é obrigatório a apresentação de documento que comprove o direito do benefício, juntamente com a carteira de identidade, na compra do ingresso e na entrada do evento. Caso exista suspeita de fraude no seu ingresso o mesmo poderá ser cancelado por livre iniciativa da SeuTickets. Por isso, sempre compre seu ingresso por meio de um canal oficial da SeuTickets ou do produtor do evento. Caso seu ingresso seja cancelado o valor será automaticamente estornado para o cartão que realizou a compra do ingresso. Caso a compra tenha sido feita via boleto, entre em contato com o nosso suporte para depósito em conta. A SeuTickets não se responsabiliza por ingressos adquiridos fora dos pontos de venda oficiais ou internet. É de suma importância que você conheça os termos de uso da plataforma disponíveis em https://www.stingressos.com.br/termos`;
  
  doc.text(terms, 15, 95, { maxWidth: 180, align: 'justify' });

  return { 
    blob: doc.output('blob'),
    ticketCode,
    purchaseCode
  };
};
