
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

export const generateSingleTicketBlob = async (details: TicketPdfDetails, forcedCode?: string) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const generateCode = () => Math.random().toString(36).substring(2, 14).toUpperCase();
  // Se forcedCode existir (re-download), usamos ele. Se não, geramos um novo.
  const ticketCode = forcedCode || generateCode();
  const purchaseCode = generateCode();
  
  // Cores Oficiais da Imagem
  const orangeSt = [255, 80, 0]; 
  const textDarkGray = [60, 60, 60];
  const labelGray = [140, 140, 140];

  // --- PÁGINA 1 ---
  
  // Fundo Laranja do Topo (Largura total 190mm)
  doc.setFillColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.rect(10, 10, 190, 130, 'F');

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
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('ST', logoX + 16, logoY + 11);
  
  doc.setFont('helvetica', 'normal');
  const stWidth = doc.getTextWidth('ST');
  doc.text('ingressos', logoX + 16 + stWidth, logoY + 11);

  // Linha pontilhada topo
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(15, 48, 195, 48);

  // "C A R T Ã O  D E  A C E S S O"
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const accessText = 'C   A   R   T   Ã   O      D   E      A   C   E   S   S   O';
  doc.text(accessText, 105, 58, { align: 'center' });

  // Nome do Evento
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  const eventNameUpper = (details.eventName || 'EVENTO').toUpperCase();
  doc.text(eventNameUpper, 105, 76, { align: 'center', maxWidth: 180 });

  // Linha pontilhada meio
  doc.line(15, 92, 195, 92);

  // --- INFORMAÇÕES DO EVENTO ---
  doc.setFontSize(10.5);
  
  const l1Label1 = 'Abertura: ';
  const l1Val1 = details.openingTime || '--/--/---- --:--';
  const l1Label2 = '   Local: ';
  const l1Val2 = details.venue || 'A Definir';
  
  const fullL1Width = doc.getTextWidth(l1Label1) + doc.getTextWidth(l1Val1) + doc.getTextWidth(l1Label2) + doc.getTextWidth(l1Val2);
  let curX = 105 - (fullL1Width / 2);
  
  doc.setFont('helvetica', 'normal'); doc.text(l1Label1, curX, 105); curX += doc.getTextWidth(l1Label1);
  doc.setFont('helvetica', 'bold'); doc.text(l1Val1, curX, 105); curX += doc.getTextWidth(l1Val1);
  doc.setFont('helvetica', 'normal'); doc.text(l1Label2, curX, 105); curX += doc.getTextWidth(l1Label2);
  doc.setFont('helvetica', 'bold'); doc.text(l1Val2, curX, 105);

  // Linha 2: Endereço
  doc.setFontSize(9.5);
  const addrLabel = 'Endereço: ';
  const addrValue = details.address || 'Não informado';
  const splitAddr = doc.splitTextToSize(addrValue, 160);
  
  let addrY = 112;
  const addrLabelW = doc.getTextWidth(addrLabel);
  const firstLineW = addrLabelW + doc.getTextWidth(splitAddr[0]);
  const addrStartX = 105 - (firstLineW / 2);
  
  doc.setFont('helvetica', 'normal');
  doc.text(addrLabel, addrStartX, addrY);
  doc.setFont('helvetica', 'bold');
  doc.text(splitAddr, addrStartX + addrLabelW, addrY);
  
  // Linha 3: Produzido e Contato
  doc.setFontSize(10.5);
  const prodY = addrY + (splitAddr.length * 5) + 2;
  const l3Label1 = 'Produzido: ';
  const l3Val1 = details.producer || 'Organização';
  const l3Label2 = '   Contato: ';
  const l3Val2 = details.contact || '-';
  
  const fullL3Width = doc.getTextWidth(l3Label1) + doc.getTextWidth(l3Val1) + doc.getTextWidth(l3Label2) + doc.getTextWidth(l3Val2);
  let curX3 = 105 - (fullL3Width / 2);
  
  doc.setFont('helvetica', 'normal'); doc.text(l3Label1, curX3, prodY); curX3 += doc.getTextWidth(l3Label1);
  doc.setFont('helvetica', 'bold'); doc.text(l3Val1, curX3, prodY); curX3 += doc.getTextWidth(l3Val1);
  doc.setFont('helvetica', 'normal'); doc.text(l3Label2, curX3, prodY); curX3 += doc.getTextWidth(l3Label2);
  doc.setFont('helvetica', 'bold'); doc.text(l3Val2, curX3, prodY);

  // --- ÁREA BRANCA ---
  const startDataY = 155;
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Ingresso', 15, startDataY);
  doc.text('Participante', 195, startDataY, { align: 'right' });
  
  doc.setTextColor(textDarkGray[0], textDarkGray[1], textDarkGray[2]);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(details.sector || 'Geral', 15, startDataY + 8);
  doc.text(details.ownerName || 'Convidado', 195, startDataY + 8, { align: 'right' });

  // Bloco de Códigos
  const secondDataY = 182;
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Código da Compra', 15, secondDataY);
  doc.text('Código do ingresso', 195, secondDataY, { align: 'right' });

  doc.setTextColor(textDarkGray[0], textDarkGray[1], textDarkGray[2]);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(purchaseCode, 15, secondDataY + 8);
  doc.text(ticketCode, 195, secondDataY + 8, { align: 'right' });

  // Linha separadora antes do QR
  doc.setDrawColor(230, 230, 230);
  doc.setLineDashPattern([2, 1], 0);
  doc.line(15, 202, 195, 202);

  // QR CODE
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${ticketCode}`;
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = qrUrl;
  await new Promise((resolve) => {
    img.onload = () => {
      doc.addImage(img, 'PNG', 65, 212, 80, 80);
      resolve(true);
    };
    img.onerror = () => resolve(false);
  });

  // --- PÁGINA 2 (TERMOS) ---
  doc.addPage();
  doc.setDrawColor(orangeSt[0], orangeSt[1], orangeSt[2]); 
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([], 0);
  doc.roundedRect(10, 10, 190, 277, 4, 4);

  doc.setTextColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMAÇÃO IMPORTANTE!', 105, 30, { align: 'center' });

  doc.setFontSize(13);
  doc.setLineHeightFactor(1.4);
  const infoText = `Você está recebendo apenas um ingresso da compra ${ticketCode}. Este ingresso estará sujeito a cancelamentos, ou mudanças por parte do comprador. No dia do evento, documentos de identificação pessoal e da compra poderão ser exigidos na entrada do evento. Lembre-se que a forma mais segura de você comprar ingressos é diretamente na nossa plataforma.\nCaso essa compra fira nossos termos de uso ou a legislação vigente, você poderá ser responsabilizado. Qualquer dúvida leia nossos termos de uso ou entre em contato conosco.`;
  
  doc.text(infoText, 15, 48, { maxWidth: 180, align: 'justify' });

  doc.setTextColor(110, 110, 110);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setLineHeightFactor(1.2);
  const terms = `A SeuTickets emitiu este ingresso por força de contrato de prestação de serviço celebrado com o promotor do evento. O mesmo é o único responsável pela realização, cancelamento ou adiamento do evento e/ou espetáculo, bem como pela restituição do valor do ingresso. Seu ingresso e as informações nele contidas são de sua responsabilidade. Não compartilhe fotos nem informações sobre ele com outras pessoas. Qualquer uso por outra pessoa do seu ingresso não será de responsabilidade da SeuTickets. Este ingresso possui itens de segurança e estará sujeito à verificação na portaria do evento. O código de barras contido neste ingresso é único e não se repete, garantindo acesso apenas uma única vez ao evento. A organização do evento reserva-se o direito de solicitar um documento com foto e o cartão utilizado na compra na entrada do evento. Este evento poderá ser gerado, filmado ou fotografado. Ao participar do evento, o portador deste ingresso concorda e autoriza a utilização gratuita de sua imagem por prazo indeterminado. Meia entrada: é obrigatório a apresentação de documento que comprove o direito do benefício, juntamente com a carteira de identidade, na compra do ingresso e na entrada do evento. Caso exista suspeita de fraude no seu ingresso o mesmo poderá ser cancelado por livre iniciativa da SeuTickets. Por isso, sempre compre seu ingresso por meio de um canal oficial da SeuTickets ou do produtor do evento. Caso seu ingresso seja cancelado o valor será automaticamente estornado para o cartão que realizou a compra do ingresso. Caso a compra tenha sido feita via boleto, entre em contato com o nosso suporte para depósito em conta. A SeuTickets não se responsabiliza por ingressos adquiridos fora dos pontos de venda oficiais ou internet. É de suma importância que você conheça os termos de uso da plataforma disponíveis em https://www.stingressos.com.br/termos`;
  
  doc.text(terms, 15, 115, { maxWidth: 180, align: 'justify' });

  return { 
    blob: doc.output('blob'),
    ticketCode,
    purchaseCode
  };
};
