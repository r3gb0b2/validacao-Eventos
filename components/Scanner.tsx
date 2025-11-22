// FIX: Implement the Scanner component to provide QR code scanning functionality.
// This file previously contained placeholder text, causing module resolution errors.
import React, { useEffect, useRef } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

interface ScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onScanError: (errorMessage: string) => void;
}

const Scanner: React.FC<ScannerProps> = ({ onScanSuccess, onScanError }) => {
  // Use a ref for the success callback to ensure the latest version is always called
  // without re-initializing the scanner every time the parent component re-renders.
  const onScanSuccessRef = useRef(onScanSuccess);
  onScanSuccessRef.current = onScanSuccess;
  
  useEffect(() => {
    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true,
        // Prioritize the rear camera to avoid the user having to select it.
        videoConstraints: {
            facingMode: "environment"
        }
    };
    
    const scanner = new Html5QrcodeScanner(
      'qr-scanner-container',
      config,
      /* verbose= */ false
    );

    const handleSuccess = (decodedText: string) => {
      onScanSuccessRef.current(decodedText);
    };

    const handleError = (errorMessage: string) => {
      // This callback fires continuously when no QR code is found.
      // The parent component in this app doesn't use it, so we can leave it empty
      // to avoid console noise or unnecessary state updates.
    };

    scanner.render(handleSuccess, handleError);

    return () => {
      // Check if scanner.clear() returns a promise to avoid unhandled promise rejections.
      const clearPromise = scanner.clear();
      if (clearPromise) {
          clearPromise.catch(error => {
            console.error("Failed to clear html5-qrcode scanner.", error);
          });
      }
    };
  }, []); // Empty dependency array ensures this effect runs only once on mount and unmount.

  return <div id="qr-scanner-container" />;
};

export default Scanner;