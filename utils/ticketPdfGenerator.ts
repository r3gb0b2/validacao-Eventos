
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
  
  // Cores Oficiais ST
  const orangeSt = [255, 94, 14]; 
  const darkGray = [50, 50, 50];
  const labelGray = [120, 120, 120];

  // --- PÁGINA 1 ---
  
  // Cabeçalho Laranja
  doc.setFillColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.rect(10, 10, 190, 120, 'F');

  // Logo + Nome (Simulado)
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  
  // Desenho do ícone da logo (círculo branco pequeno com detalhe)
  doc.setFillColor(255, 255, 255);
  doc.circle(75, 28, 4, 'F');
  doc.setFillColor(orangeSt[0], orangeSt[1], orangeSt[2]);
  doc.circle(75, 28, 2, 'F'); // detalhe interno
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.text('STingressos', 82, 31);

  // Linha pontilhada branca
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(20, 45, 190, 45);

  // Cartão de Acesso
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('C A R T Ã O   D E   A C E S S O', 105, 54, { align: 'center' });

  // Nome do Evento (Grande e Extra Bold)
  doc.setFontSize(30);
  doc.setFont('helvetica', 'bold');
  doc.text(details.eventName.toUpperCase(), 105, 68, { align: 'center' });

  // Linha pontilhada branca 2
  doc.line(20, 78, 190, 78);

  // Detalhes do Evento
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(`Abertura: ${details.openingTime}   Local: ${details.venue}`, 105, 90, { align: 'center' });
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Endereço: ${details.address}`, 105, 98, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.text(`Produzido: ${details.producer}   Contato: ${details.contact}`, 105, 108, { align: 'center' });

  // --- ÁREA DE INFORMAÇÕES DO CLIENTE (BRANCO) ---
  
  // Rótulos (Cinza Claro)
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Ingresso', 15, 145);
  doc.text('Participante', 195, 145, { align: 'right' });
  
  // Dados (Cinza Escuro e Bold)
  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(details.sector, 15, 154);
  doc.text(details.ownerName, 195, 154, { align: 'right' });

  // Segunda linha de dados
  doc.setTextColor(labelGray[0], labelGray[1], labelGray[2]);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Código da Compra', 15, 168);
  doc.text('Código do ingresso', 195, 168, { align: 'right' });

  doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(purchaseCode, 15, 177);
  doc.text(ticketCode, 195, 177, { align: 'right' });

  // Linha divisória cinza pontilhada
  doc.setDrawColor(200, 200, 200);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(15, 185, 195, 185);

  // QR CODE
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${ticketCode}`;
  const img = new Image();
  img.crossOrigin = "Anonymous";
  img.src = qrUrl;
  await new Promise((resolve) => {
    img.onload = () => {
      doc.addImage(img, 'PNG', 65, 195, 80, 80);
      resolve(true);
    };
  });

  // --- PÁGINA 2 (TERMOS) ---
  doc.addPage();
  
  doc.setDrawColor(255, 0, 80); // Cor dos termos (Rosa/Vermelho)
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([], 0);
  doc.rect(10, 10, 190, 277);

  doc.setTextColor(255, 0, 80);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('INFORMAÇÃO IMPORTANTE!', 105, 25, { align: 'center' });

  doc.setFontSize(12);
  const infoText = `Você está recebendo apenas um ingresso da compra ${ticketCode}. Este ingresso estará sujeito a cancelamentos, ou mudanças por parte do comprador. No dia do evento, documentos de identificação pessoal e da compra poderão ser exigidos na entrada do evento. Lembre-se que a forma mais segura de você comprar ingressos é diretamente na nossa plataforma. Caso essa compra fira nossos termos de uso ou a legislação vigente, você poderá ser responsabilizado. Qualquer dúvida leia nossos termos de uso ou entre em contato conosco.`;
  
  doc.text(infoText, 15, 38, { maxWidth: 180, align: 'justify' });

  // Termos de Uso (Texto pequeno)
  doc.setTextColor(100, 100, 100);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  const terms = `A SeuTickets emitiu este ingresso por força de contrato de prestação de serviço celebrado com o promotor do evento. O mesmo é o único responsável pela realização, cancelamento ou adiamento do evento e/ou espetáculo, bem como pela restituição do valor do ingresso. Seu ingresso e as informações nele contidas são de sua responsabilidade. Não compartilhe fotos nem informações sobre ele com outras pessoas. Qualquer uso por outra pessoa do seu ingresso não será de responsabilidade da SeuTickets. Este ingresso possui itens de segurança e estará sujeito à verificação na portaria do evento. O código de barras contido neste ingresso é único e não se repete, garantindo acesso apenas uma única vez ao evento. A organização do evento reserva-se o direito de solicitar um documento com foto e o cartão utilizado na compra na entrada do evento. Este evento poderá ser gerado, filmado ou fotografado. Ao participar do evento, o portador deste ingresso concorda e autoriza a utilização gratuita de sua imagem por prazo indeterminado. Meia entrada: é obrigatório a apresentação de documento que comprove o direito do benefício, juntamente com a carteira de identidade, na compra do ingresso e na entrada do evento. Caso exista suspeita de fraude no seu ingresso o mesmo poderá ser cancelado por livre iniciativa da SeuTickets. Por isso, sempre compre seu ingresso por meio de um canal oficial da SeuTickets ou do produtor do evento. Caso seu ingresso seja cancelado o valor será automaticamente estornado para o cartão que realizou a compra do ingresso. Caso a compra tenha sido feita via boleto, entre em contato com o nosso suporte para depósito em conta. A SeuTickets não se responsabiliza por ingressos adquiridos fora dos pontos de venda oficiais ou internet. É de suma importância que você conheça os termos de uso da plataforma disponíveis em https://www.stingressos.com.br/termos`;
  
  doc.text(terms, 15, 95, { maxWidth: 180, align: 'justify' });

  return { 
    blob: doc.output('blob'),
    ticketCode,
    purchaseCode
  };
};
