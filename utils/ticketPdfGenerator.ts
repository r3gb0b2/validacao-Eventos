
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
  logoUrl?: string; 
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

export const generateSingleTicketBlob = async (details: TicketPdfDetails, forcedTicketCode?: string, forcedPurchaseCode?: string) => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Gera códigos de exatamente 12 caracteres
  const generateCode = () => Math.random().toString(36).substring(2, 14).toUpperCase().padEnd(12, 'X');
  
  const ticketCode = forcedTicketCode || generateCode();
  const purchaseCode = forcedPurchaseCode || generateCode();
  
  // CORES DEFINIDAS
  const orangeHeader = [254, 85, 29]; // #fe551d
  const textPrimary = [80, 108, 123]; // #506c7b (Cinza do código do ingresso)
  const redAlert = [220, 38, 38];    // #dc2626 (Vermelho para o título e avisos)

  // --- PÁGINA 1 ---
  
  doc.setFillColor(orangeHeader[0], orangeHeader[1], orangeHeader[2]);
  doc.rect(10, 10, 190, 130, 'F');

  doc.setTextColor(255, 255, 255);

  const finalLogoUrl = details.logoUrl || 'https://i.ibb.co/LzNf9F5/logo-st-ingressos-white.png';
  
  try {
    const logoImg = await loadImage(finalLogoUrl);
    const targetHeight = 22.5; 
    const ratio = logoImg.width / logoImg.height;
    const targetWidth = targetHeight * ratio;
    const xPos = 105 - (targetWidth / 2);
    const yPos = 20; 

    doc.addImage(logoImg, 'PNG', xPos, yPos, targetWidth, targetHeight);
  } catch (e) {
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(details.producer || 'ST INGRESSOS', 105, 32, { align: 'center' });
  }

  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(15, 48, 195, 48);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  const accessText = 'C   A   R   T   Ã   O      D   E      A   C   E   S   S   O';
  doc.text(accessText, 105, 58, { align: 'center' });

  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  const eventNameUpper = (details.eventName || 'EVENTO').toUpperCase();
  doc.text(eventNameUpper, 105, 76, { align: 'center', maxWidth: 180 });

  doc.line(15, 92, 195, 92);

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

  // --- ENDEREÇO CENTRALIZADO COM QUEBRA DE LINHA ---
  const addrFontSize = 12.5;
  doc.setFontSize(addrFontSize);
  const addrValue = details.address || 'Não informado';
  
  // Margem de 10% nas laterais (210 - 42 = 168mm de largura útil)
  const maxWidthAddress = 168; 

  // Rótulo centralizado
  doc.setFont('helvetica', 'normal');
  doc.text('Endereço:', 105, 113, { align: 'center' });
  
  // Valor centralizado individualmente por linha
  doc.setFont('helvetica', 'bold');
  const splitAddr = doc.splitTextToSize(addrValue, maxWidthAddress);
  
  let currentAddrY = 119;
  splitAddr.forEach((line: string) => {
    doc.text(line.trim(), 105, currentAddrY, { align: 'center' });
    currentAddrY += 6; 
  });
  
  // --- PRODUTORA E CONTATO COM QUEBRA DE LINHA ---
  const footerFontSize = 11.5;
  doc.setFontSize(footerFontSize);
  const maxWidthFooter = 175;
  
  const producerText = details.producer || 'Organização';
  const contactText = details.contact || '-';
  const combinedFooter = `Produzido por: ${producerText}  |  Contato: ${contactText}`;
  
  const splitFooter = doc.splitTextToSize(combinedFooter, maxWidthFooter);
  
  // Calcula o Y inicial garantindo que não sobreponha o endereço
  let currentFooterY = Math.max(currentAddrY + 1, 128); 
  
  doc.setFont('helvetica', 'bold');
  splitFooter.forEach((line: string) => {
    // Garante que não saia do box laranja (Y=140)
    if (currentFooterY <= 138) {
        doc.text(line.trim(), 105, currentFooterY, { align: 'center' });
        currentFooterY += 5;
    }
  });

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

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${ticketCode}`;
  try {
    const qrImg = await loadImage(qrUrl);
    doc.addImage(qrImg, 'PNG', 65, 188, 80, 80);
  } catch (e) {
    console.error("Erro ao carregar QR Code");
  }

  // --- PÁGINA 2 (TERMOS) ---
  doc.addPage();
  
  // Título em VERMELHO e NEGRITO
  doc.setTextColor(redAlert[0], redAlert[1], redAlert[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('INFORMAÇÃO IMPORTANTE!', 105, 30, { align: 'center' });

  // Texto informativo em VERMELHO e NEGRITO
  doc.setFontSize(13);
  doc.setLineHeightFactor(1.4);
  const infoText = `Você está recebendo apenas um ingresso da compra ${purchaseCode}. Este ingresso estará sujeito a cancelamentos, ou mudanças por parte do comprador. No dia do evento, documentos de identificação pessoal e da compra poderão ser exigidos na entrada do evento. Lembre-se que a forma mais segura de você comprar ingressos é diretamente na nossa plataforma.\nCaso essa compra fira nossos termos de uso ou a legislação vigente, você poderá ser responsabilizado. Qualquer dúvida leia nossos termos de uso ou entre em contato conosco.`;
  
  // Margem de segurança para o texto não vazar: 175mm largura
  doc.text(infoText, 17.5, 48, { maxWidth: 175, align: 'justify' });

  // Termos de Uso em CINZA e NORMAL
  doc.setTextColor(textPrimary[0], textPrimary[1], textPrimary[2]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setLineHeightFactor(1.2);
  const terms = `A SeuTickets emitiu este ingresso por força de contrato de prestação de serviço celebrado com o promotor do evento. O mesmo é o único responsável pela realização, cancelamento ou adiamento do evento e/ou espetáculo, bem como pela restituição do valor do ingresso. Seu ingresso e as informações nele contidas são de sua responsabilidade. Não compartilhe fotos nem informações sobre ele com outras pessoas. Qualquer uso por outra pessoa do seu ingresso não será de responsabilidade da SeuTickets. Este ingresso possui itens de segurança e estará sujeito à verificação na portaria do evento. O código de barras contido neste ingresso é único e não se repete, garantindo acesso apenas uma única vez ao evento. A organização do evento reserva-se o direito de solicitar um documento com foto e o cartão utilizado na compra na entrada do evento. Este evento poderá ser gerado, filmado ou fotografado. Ao participar do evento, o portador deste ingresso concorda e autoriza a utilização gratuita de sua imagem por prazo indeterminado. Meia entrada: é obrigatório a apresentação de documento que comprove o direito do benefício, juntamente com a carteira de identidade, na compra do ingresso e na entrada do evento. Caso exista suspeita de fraude no seu ingresso o mesmo poderá ser cancelado por livre iniciativa da SeuTickets. Por isso, sempre compre seu ingresso por meio de um canal oficial da SeuTickets ou do produtor do evento. Caso seu ingresso seja cancelado o valor será automaticamente estornado para o cartão que realizou a compra do ingresso. Caso a compra tenha sido feita via boleto, entre em contato com o nosso suporte para depósito em conta. A SeuTickets não se responsabiliza por ingressos adquiridos fora dos pontos de venda oficiais ou internet. É de suma importância que você conheça os termos de uso da plataforma disponíveis em https://www.stingressos.com.br/termos`;
  
  const termsX = 17.5;
  const termsY = 115;
  const termsMaxWidth = 175;
  
  // Imprime os termos respeitando a largura máxima para não vazar das margens
  doc.text(terms, termsX, termsY, { maxWidth: termsMaxWidth, align: 'justify' });

  // --- CONTORNO DINÂMICO ---
  // Calcula a altura aproximada baseada no split para fechar a caixa
  const splitTerms = doc.splitTextToSize(terms, termsMaxWidth);
  const termsLineHeight = (9.5 * 1.2 * 0.3527); // Converte fontSize * lineHeight para mm
  const totalTermsHeight = splitTerms.length * termsLineHeight;
  const finalBoxHeight = (termsY + totalTermsHeight - 10) + 10; 

  doc.setDrawColor(redAlert[0], redAlert[1], redAlert[2]); 
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([], 0);
  doc.roundedRect(10, 10, 190, finalBoxHeight, 4, 4);

  return { 
    blob: doc.output('blob'),
    ticketCode,
    purchaseCode
  };
};
