
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
  
  // Cores Oficiais da Imagem
  const orangeSt = [255, 80, 0]; 
  const textDarkGray = [60, 60, 60];
  const labelGray = [140, 140, 140];

  // --- PÁGINA 1 ---
  
  // Fundo Laranja do Topo
  doc.setFillColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.rect(10, 10, 190, 125, 'F');

  // --- LOGO ---
  const logoX = 68;
  const logoY = 25;
  
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(logoX, logoY, 13, 13, 2.5, 2.5, 'F');
  
  doc.setFillColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.roundedRect(logoX + 3.5, logoY + 3.5, 6, 6, 1, 1, 'F');
  
  doc.setFillColor(255, 255, 255);
  doc.circle(logoX + 4.8, logoY + 5.5, 0.4, 'F');
  doc.circle(logoX + 6.5, logoY + 5.5, 0.4, 'F');
  doc.circle(logoX + 8.2, logoY + 5.5, 0.4, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('ST', logoX + 15, logoY + 10.5);
  
  doc.setFont('helvetica', 'normal');
  const stWidth = doc.getTextWidth('ST');
  doc.text('ingressos', logoX + 15 + stWidth, logoY + 10.5);

  // Linha pontilhada topo
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(20, 45, 190, 45);

  // "C A R T Ã O  D E  A C E S S O"
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('C  A  R  T  Ã  O    D  E    A  C  E  S  S  O', 105, 53, { align: 'center' });

  // Nome do Evento (Grande e Bold)
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(details.eventName.toUpperCase(), 105, 70, { align: 'center', maxWidth: 170 });

  // Linha pontilhada meio
  doc.line(20, 85, 190, 85);

  // --- INFORMAÇÕES DO EVENTO (DENTRO DO LARANJA) ---
  doc.setFontSize(10);
  
  const drawOrangeSectionInfo = (label: string, value: string, y: number) => {
    doc.setFont('helvetica', 'normal');
    const labelW = doc.getTextWidth(label);
    doc.setFont('helvetica', 'bold');
    const valueW = doc.getTextWidth(value);
    
    const startX = 105 - ((labelW + valueW) / 2);
    
    doc.setFont('helvetica', 'normal');
    doc.text(label, startX, y);
    doc.setFont('helvetica', 'bold');
    doc.text(value, startX + labelW, y);
  };

  // Linha 1: Abertura e Local
  const l1Label1 = 'Abertura: ';
  const l1Val1 = details.openingTime;
  const l1Label2 = '   Local: ';
  const l1Val2 = details.venue;
  
  const fullL1Width = doc.getTextWidth(l1Label1) + doc.getTextWidth(l1Val1) + doc.getTextWidth(l1Label2) + doc.getTextWidth(l1Val2);
  let curX = 105 - (fullL1Width / 2);
  
  doc.setFont('helvetica', 'normal'); doc.text(l1Label1, curX, 98); curX += doc.getTextWidth(l1Label1);
  doc.setFont('helvetica', 'bold'); doc.text(l1Val1, curX, 98); curX += doc.getTextWidth(l1Val1);
  doc.setFont('helvetica', 'normal'); doc.text(l1Label2, curX, 98); curX += doc.getTextWidth(l1Label2);
  doc.setFont('helvetica', 'bold'); doc.text(l1Val2, curX, 98);

  // Linha 2: Endereço (Com Wrap)
  doc.setFontSize(9);
  const addrLabel = 'Endereço: ';
  const addrValue = details.address;
  const splitAddr = doc.splitTextToSize(addrValue, 140);
  
  let addrY = 105;
  doc.setFont('helvetica', 'normal');
  const addrLabelW = doc.getTextWidth(addrLabel);
  // Centralizando o bloco de endereço
  const firstLineW = addrLabelW + doc.getTextWidth(splitAddr[0]);
  const addrStartX = 105 - (firstLineW / 2);
  
  doc.text(addrLabel, addrStartX, addrY);
  doc.setFont('helvetica', 'bold');
  doc.text(splitAddr, addrStartX + addrLabelW, addrY);
  
  // Linha 3: Produzido e Contato
  doc.setFontSize(10);
  const prodY = addrY + (splitAddr.length * 5) + 2;
  const l3Label1 = 'Produzido: ';
  const l3Val1 = details.producer;
  const l3Label2 = '  Contato: ';
  const l3Val2 = details.contact;
  
  const fullL3Width = doc.getTextWidth(l3Label1) + doc.getTextWidth(l3Val1) + doc.getTextWidth(l3Label2) + doc.getTextWidth(l3Val2);
  let curX3 = 105 - (fullL3Width / 2);
  
  doc.setFont('helvetica', 'normal'); doc.text(l3Label1, curX3, prodY); curX3 += doc.getTextWidth(l3Label1);
  doc.setFont('helvetica', 'bold'); doc.text(l3Val1, curX3, prodY); curX3 += doc.getTextWidth(l3Val1);
  doc.setFont('helvetica', 'normal'); doc.text(l3Label2, curX3, prodY); curX3 += doc.getTextWidth(l3Label2);
  doc.setFont('helvetica', 'bold'); doc.text(l3Val2, curX3, prodY);

  // --- ÁREA BRANCA (DADOS PARTICIPANTE) ---
  const startDataY = 150;
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Ingresso', 15, startDataY);
  doc.text('Participante', 195, startDataY, { align: 'right' });
  
  doc.setTextColor(textDarkGray[0], textDarkGray[1], textDarkGray[2]);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(details.sector, 15, startDataY + 7);
  doc.text(details.ownerName, 195, startDataY + 7, { align: 'right' });

  // Bloco 2
  const secondDataY = 175;
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Código da Compra', 15, secondDataY);
  doc.text('Código do ingresso', 195, secondDataY, { align: 'right' });

  doc.setTextColor(textDarkGray[0], textDarkGray[1], textDarkGray[2]);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(purchaseCode, 15, secondDataY + 7);
  doc.text(ticketCode, 195, secondDataY + 7, { align: 'right' });

  // Linha separadora QR
  doc.setDrawColor(220, 220, 220);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(15, 195, 195, 195);

  // QR CODE
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${ticketCode}`;
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = qrUrl;
  await new Promise((resolve) => {
    img.onload = () => {
      doc.addImage(img, 'PNG', 70, 205, 70, 70);
      resolve(true);
    };
    img.onerror = () => resolve(false);
  });

  // --- PÁGINA 2 (TERMOS) ---
  doc.addPage();
  doc.setDrawColor(orangeSt[0], orangeSt[1], orangeSt[2]); 
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([], 0);
  doc.roundedRect(10, 10, 190, 277, 3, 3);

  doc.setTextColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMAÇÃO IMPORTANTE!', 105, 30, { align: 'center' });

  doc.setFontSize(12);
  const infoText = `Você está recebendo apenas um ingresso da compra ${ticketCode}. Este ingresso estará sujeito a cancelamentos, ou mudanças por parte do comprador. No dia do evento, documentos de identificação pessoal e da compra poderão ser exigidos na entrada do evento. Lembre-se que a forma mais segura de você comprar ingressos é diretamente na nossa plataforma.\nCaso essa compra fira nossos termos de uso ou a legislação vigente, você poderá ser responsabilizado. Qualquer dúvida leia nossos termos de uso ou entre em contato conosco.`;
  
  doc.text(infoText, 15, 45, { maxWidth: 180, align: 'justify' });

  doc.setTextColor(110, 110, 110);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const terms = `A SeuTickets emitiu este ingresso por força de contrato de prestação de serviço celebrado com o promotor do evento. O mesmo é o único responsável pela realização, cancelamento ou adiamento do evento e/ou espetáculo, bem como pela restituição do valor do ingresso. Seu ingresso e as informações nele contidas são de sua responsabilidade. Não compartilhe fotos nem informações sobre ele com outras pessoas. Qualquer uso por outra pessoa do seu ingresso não será de responsabilidade da SeuTickets. Este ingresso possui itens de segurança e estará sujeito à verificação na portaria do evento. O código de barras contido neste ingresso é único e não se repete, garantindo acesso apenas uma única vez ao evento. A organização do evento reserva-se o direito de solicitar um documento com foto e o cartão utilizado na compra na entrada do evento. Este evento poderá ser gerado, filmado ou fotografado. Ao participar do evento, o portador deste ingresso concorda e autoriza a utilização gratuita de sua imagem por prazo indeterminado. Meia entrada: é obrigatório a apresentação de documento que comprove o direito do benefício, juntamente com a carteira de identidade, na compra do ingresso e na entrada do evento. Caso exista suspeita de fraude no seu ingresso o mesmo poderá ser cancelado por livre iniciativa da SeuTickets. Por isso, sempre compre seu ingresso por meio de um canal oficial da SeuTickets ou do produtor do evento. Caso seu ingresso seja cancelado o valor será automaticamente estornado para o cartão que realizou a compra do ingresso. Caso a compra tenha sido feita via boleto, entre em contato com o nosso suporte para depósito em conta. A SeuTickets não se responsabiliza por ingressos adquiridos fora dos pontos de venda oficiais ou internet. É de suma importância que você conheça os termos de uso da plataforma disponíveis em https://www.stingressos.com.br/termos`;
  
  doc.text(terms, 15, 105, { maxWidth: 180, align: 'justify' });

  return { 
    blob: doc.output('blob'),
    ticketCode,
    purchaseCode
  };
};
