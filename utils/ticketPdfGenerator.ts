
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
  logoUrl?: string; // Nova propriedade para logo dinâmica
}

const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = url;
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
  });
};

export const generateSingleTicketBlob = async (details: TicketPdfDetails, forcedCode?: string) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Gera códigos de exatamente 12 caracteres
  const generateCode = () => Math.random().toString(36).substring(2, 14).toUpperCase().padEnd(12, 'X');
  
  const ticketCode = forcedCode || generateCode();
  const purchaseCode = generateCode();
  
  // Cores Solicitadas
  const orangeHeader = [254, 85, 29]; // #fe551d
  const textPrimary = [80, 108, 123]; // #506c7b

  // --- PÁGINA 1 ---
  
  // Fundo Laranja do Topo (#fe551d)
  doc.setFillColor(orangeHeader[0], orangeHeader[1], orangeHeader[2]);
  doc.rect(10, 10, 190, 130, 'F');

  // Define a cor do texto como BRANCO para toda a parte de cima (área laranja)
  doc.setTextColor(255, 255, 255);

  // --- LOGO (DINÂMICA) ---
  const finalLogoUrl = details.logoUrl || 'https://i.ibb.co/LzNf9F5/logo-st-ingressos-white.png';
  
  try {
    const logoImg = await loadImage(finalLogoUrl);
    
    // Aumento de 25% na logo: 18mm * 1.25 = 22.5mm
    const targetHeight = 22.5;
    const ratio = logoImg.width / logoImg.height;
    const targetWidth = targetHeight * ratio;
    
    // Centraliza horizontalmente
    const xPos = 105 - (targetWidth / 2);
    const yPos = 20; // Ajustado levemente para cima devido ao aumento de tamanho

    doc.addImage(logoImg, 'PNG', xPos, yPos, targetWidth, targetHeight);
  } catch (e) {
    console.warn("Não foi possível carregar a imagem da logo. Usando fallback de texto.");
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(details.producer || 'ST INGRESSOS', 105, 32, { align: 'center' });
  }

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
  const headerFontSize = 13.5;
  doc.setFontSize(headerFontSize);
  
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
  const addrFontSize = 12.5;
  doc.setFontSize(addrFontSize);
  const addrLabel = 'Endereço: ';
  const addrValue = details.address || 'Não informado';
  const splitAddr = doc.splitTextToSize(addrValue, 165);
  
  let addrY = 113;
  const addrLabelW = doc.getTextWidth(addrLabel);
  const firstLineW = addrLabelW + doc.getTextWidth(splitAddr[0]);
  const addrStartX = 105 - (firstLineW / 2);
  
  doc.setFont('helvetica', 'normal');
  doc.text(addrLabel, addrStartX, addrY);
  doc.setFont('helvetica', 'bold');
  doc.text(splitAddr, addrStartX + addrLabelW, addrY);
  
  // Linha 3: Produzido e Contato
  doc.setFontSize(headerFontSize);
  const prodY = addrY + (splitAddr.length * 6) + 1;
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

  // --- ÁREA BRANCA (DADOS COMPACTOS) ---
  const startDataY = 148; 
  doc.setTextColor(textPrimary[0], textPrimary[1], textPrimary[2]);
  
  const labelFontSize = 11.25; 
  const valueFontSize = 17.1;  
  
  doc.setFontSize(labelFontSize);
  doc.setFont('helvetica', 'normal'); 
  doc.text('Ingresso', 15, startDataY);
  doc.text('Participante', 195, startDataY, { align: 'right' });
  
  doc.setFontSize(valueFontSize);
  doc.setFont('helvetica', 'bold'); 
  doc.text(details.sector || 'Geral', 15, startDataY + 6.2);
  doc.text(details.ownerName || 'Convidado', 195, startDataY + 6.2, { align: 'right' });

  const secondDataY = 162; 
  doc.setFontSize(labelFontSize);
  doc.setFont('helvetica', 'normal'); 
  doc.text('Código da Compra', 15, secondDataY);
  doc.text('Código do ingresso', 195, secondDataY, { align: 'right' });

  const codeValueFontSize = 18; 
  doc.setFontSize(codeValueFontSize);
  doc.setFont('helvetica', 'bold'); 
  doc.text(purchaseCode, 15, secondDataY + 6.5);
  doc.text(ticketCode, 195, secondDataY + 6.5, { align: 'right' });

  doc.setDrawColor(textPrimary[0], textPrimary[1], textPrimary[2]);
  doc.setLineWidth(0.1);
  doc.setLineDashPattern([1.5, 1], 0);
  doc.line(15, 182, 195, 182);

  // QR CODE
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${ticketCode}`;
  try {
    const qrImg = await loadImage(qrUrl);
    doc.addImage(qrImg, 'PNG', 65, 188, 80, 80);
  } catch (e) {
    console.error("Erro ao carregar QR Code");
  }

  // --- PÁGINA 2 (TERMOS) ---
  doc.addPage();
  doc.setDrawColor(textPrimary[0], textPrimary[1], textPrimary[2]); 
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([], 0);
  doc.roundedRect(10, 10, 190, 277, 4, 4);

  doc.setTextColor(textPrimary[0], textPrimary[1], textPrimary[2]);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMAÇÃO IMPORTANTE!', 105, 30, { align: 'center' });

  doc.setFontSize(13);
  doc.setLineHeightFactor(1.4);
  const infoText = `Você está recebendo apenas um ingresso da compra ${ticketCode}. Este ingresso estará sujeito a cancelamentos, ou mudanças por parte do comprador. No dia do evento, documentos de identificação pessoal e da compra poderão ser exigidos na entrada do evento. Lembre-se que a forma mais segura de você comprar ingressos é diretamente na nossa plataforma.\nCaso essa compra fira nossos termos de uso ou a legislação vigente, você poderá ser responsabilizado. Qualquer dúvida leia nossos termos de uso ou entre em contato conosco.`;
  
  doc.text(infoText, 15, 48, { maxWidth: 180, align: 'justify' });

  doc.setTextColor(textPrimary[0], textPrimary[1], textPrimary[2]);
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
