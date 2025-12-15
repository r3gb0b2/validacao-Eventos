import { useCallback } from 'react';

export const useSound = () => {
    const playBeep = useCallback((type: 'success' | 'error') => {
        // Tenta obter o contexto de áudio (compatibilidade com WebKit/iOS e Android WebView)
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        
        try {
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'success') {
                // Som de Sucesso: Tom agudo e curto (1000Hz)
                osc.frequency.setValueAtTime(1000, ctx.currentTime);
                osc.type = 'sine';
                
                // Volume envelope
                gain.gain.setValueAtTime(0.1, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
                
                osc.start();
                osc.stop(ctx.currentTime + 0.1);
            } else {
                // Som de Erro: Tom grave e mais longo (Sawtooth para ser "áspero")
                osc.frequency.setValueAtTime(150, ctx.currentTime); // Grave
                osc.type = 'sawtooth';
                
                // Volume envelope
                gain.gain.setValueAtTime(0.2, ctx.currentTime);
                gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.4);

                osc.start();
                osc.stop(ctx.currentTime + 0.4);
            }
        } catch (e) {
            console.error("Erro ao tocar som:", e);
        }
    }, []);

    return playBeep;
};