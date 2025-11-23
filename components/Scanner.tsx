import React, { useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface ScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError: (errorMessage: string) => void;
}

const Scanner: React.FC<ScannerProps> = ({ onScanSuccess, onScanError }) => {
  // Use refs to keep callbacks fresh without re-triggering effect
  const onScanSuccessRef = useRef(onScanSuccess);
  const onScanErrorRef = useRef(onScanError);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  onScanSuccessRef.current = onScanSuccess;
  onScanErrorRef.current = onScanError;
  
  useEffect(() => {
    // 1. Initialize the scanner instance if not already done
    if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode("qr-scanner-container");
    }
    const html5QrCode = scannerRef.current;

    // 2. Configuration for the scanner
    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };

    // 3. Start the scanner explicitly using "environment" facing mode (Back Camera)
    // This bypasses the camera selection UI entirely.
    html5QrCode.start(
        { facingMode: "environment" }, 
        config,
        (decodedText) => {
            onScanSuccessRef.current(decodedText);
        },
        (errorMessage) => {
            // This runs frequently when no QR is found
            // onScanErrorRef.current(errorMessage); 
        }
    ).catch(err => {
        console.error("Erro ao iniciar câmera:", err);
        onScanErrorRef.current("Não foi possível acessar a câmera traseira. Verifique as permissões.");
    });

    // 4. Cleanup function
    return () => {
        if (html5QrCode.isScanning) {
            html5QrCode.stop().then(() => {
                html5QrCode.clear();
            }).catch(err => {
                console.error("Failed to stop scanner", err);
            });
        } else {
             html5QrCode.clear();
        }
    };
  }, []);

  return (
      <div className="w-full h-full overflow-hidden rounded-lg bg-black">
          <div id="qr-scanner-container" className="w-full h-full" />
      </div>
  );
};

export default Scanner;