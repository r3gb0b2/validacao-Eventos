import React, { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface ScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError: (errorMessage: string) => void;
}

const Scanner: React.FC<ScannerProps> = ({ onScanSuccess, onScanError }) => {
  const onScanSuccessRef = useRef(onScanSuccess);
  const onScanErrorRef = useRef(onScanError);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  
  const scannerId = "reader";

  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess;
    onScanErrorRef.current = onScanError;
  }, [onScanSuccess, onScanError]);

  useEffect(() => {
    let isMounted = true;

    const startScanner = async () => {
        try {
            await new Promise(r => setTimeout(r, 500));
            if (!isMounted) return;

            if (scannerRef.current) {
                try {
                    await scannerRef.current.stop();
                    scannerRef.current.clear();
                } catch(e) {}
            }

            const html5QrCode = new Html5Qrcode(scannerId);
            scannerRef.current = html5QrCode;

            // --- CORREÇÃO PARA APK/HYBRID ---
            const protocol = window.location.protocol;
            const isLocalOrHybrid = 
                window.location.hostname === 'localhost' || 
                protocol.includes('capacitor') || 
                protocol.includes('file') || 
                protocol.includes('app') ||
                protocol.includes('content');

            if (!isLocalOrHybrid && protocol !== 'https:') {
                 throw new Error("HTTPS_REQUIRED");
            }

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                 throw new Error("MEDIA_API_MISSING");
            }

            let devices;
            try {
                devices = await Html5Qrcode.getCameras();
            } catch (err: any) {
                if (err.name === 'NotAllowedError' || err.message?.includes('Permission denied')) {
                    throw new Error('PERMISSION_DENIED');
                }
                throw err;
            }

            if (!devices || devices.length === 0) {
                throw new Error("NO_CAMERAS");
            }

            if (!isMounted) return;

            await html5QrCode.start(
                { facingMode: "environment" }, 
                {
                    fps: 10,
                    qrbox: { width: 250, height: 250 },
                    // IMPORTANTE: AspectRatio removido para evitar distorção em telas de celular (mobile viewport)
                    // aspectRatio: 1.0, 
                    disableFlip: false
                },
                (decodedText) => {
                    if (onScanSuccessRef.current) onScanSuccessRef.current(decodedText);
                },
                (errorMessage) => {
                    // Ignora erros de frame
                }
            );

        } catch (err: any) {
            console.error("Scanner Error:", err);
            let userMessage = "Erro ao abrir câmera.";
            
            if (err.message === 'PERMISSION_DENIED') {
                userMessage = "Permissão negada! Vá nas configurações do Android e libere a câmera.";
            } else if (err.message === 'NO_CAMERAS') {
                userMessage = "Nenhuma câmera encontrada.";
            } else if (err.message === 'HTTPS_REQUIRED') {
                userMessage = "Erro de segurança: Requer HTTPS.";
            } else if (err.message === 'MEDIA_API_MISSING') {
                userMessage = "WebView sem acesso à API de mídia.";
            }

            if (isMounted && onScanErrorRef.current) {
                onScanErrorRef.current(userMessage);
            }
        }
    };

    startScanner();

    return () => {
        isMounted = false;
        if (scannerRef.current && scannerRef.current.isScanning) {
            scannerRef.current.stop().catch(() => {});
            scannerRef.current.clear().catch(() => {});
        }
    };
  }, []);

  return (
      <div className="w-full h-full bg-black rounded-lg overflow-hidden relative flex items-center justify-center">
          <div id={scannerId} className="w-full h-full" />
      </div>
  );
};

export default Scanner;