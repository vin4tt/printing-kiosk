import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Send,
  Sparkles,
  X,
  RefreshCw,
  MessageSquare,
  Globe,
  HelpCircle,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { Language } from '../types/kiosk.ts';
import { translations } from '../i18n/translations.ts';

interface GeminiVoiceAssistantProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  currentStep?: string;
  printerStatus?: string;
  kioskId?: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

export const GeminiVoiceAssistant: React.FC<GeminiVoiceAssistantProps> = ({
  isOpen,
  onClose,
  language,
  currentStep = 'HOME',
  printerStatus = 'READY',
  kioskId = 'KSK-001',
}) => {
  const t = translations[language] || translations.en;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(true);

  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize Speech Recognition on mount if supported
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;

      // Set language tag
      const langTags: Record<Language, string> = {
        en: 'en-IN',
        mr: 'mr-IN',
        hi: 'hi-IN',
        gu: 'gu-IN',
        ta: 'ta-IN',
        kn: 'kn-IN',
        es: 'es-ES',
      };
      recognition.lang = langTags[language] || 'en-IN';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          handleSendMessage(transcript);
        }
        setIsListening(false);
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    } else {
      setVoiceSupported(false);
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [language]);

  // Initial greeting message when opened
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const greetings: Record<Language, string> = {
        en: `Hello! I am your Smart Kiosk Voice Guide. Ask me anything about uploading, entering your OTP, prices, or printing.`,
        mr: `नमस्कार! मी आपला स्मार्ट किऑस्क व्हॉईस गाईड आहे. दस्तऐवज अपलोड, OTP, पेमेंट किंवा प्रिंटिंगबद्दल मला काहीही विचारा.`,
        hi: `नमस्ते! मैं आपका स्मार्ट कियोस्क वॉयस गाइड हूँ। दस्तावेज़ अपलोड, OTP, मूल्य या प्रिंटिंग के बारे में बेझिझक पूछें।`,
        gu: `નમસ્તે! હું તમારો સ્માર્ટ કિયોસ્ક વૉઇસ ગાઇડ છું. અપલોડ, OTP અથવા પ્રિન્ટિંગ વિશે કંઈ પણ પૂછો.`,
        ta: `வணக்கம்! நான் உங்கள் ஸ்மார்ட் கியோஸ்க் குரல் வழிகாட்டி. ஆவணம் பதிவேற்றம், OTP அல்லது அச்சிடுதல் பற்றி எதையும் கேளுங்கள்.`,
        kn: `ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಸ್ಮಾರ್ಟ್ ಕಿಯೋಸ್ಕ್ ಧ್ವನಿ ಮಾರ್ಗದರ್ಶಿ. ಅಪ್‌ಲೋಡ್, OTP ಅಥವಾ ಮುದ್ರಣದ ಬಗ್ಗೆ ಯಾವುದೇ ಪ್ರಶ್ನೆಯನ್ನು ಕೇಳಿ.`,
        es: `¡Hola! Soy tu asistente de voz del quiosco de impresión. Puedes preguntarme sobre cómo subir archivos, precios o imprimir sin tocar la pantalla.`,
      };

      const greetingText = greetings[language] || greetings.en;
      setMessages([
        {
          id: 'welcome',
          sender: 'assistant',
          text: greetingText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      if (speechEnabled) {
        speakText(greetingText, language);
      }
    }
  }, [isOpen, language]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // Text to Speech playback using browser SpeechSynthesis
  const speakText = (text: string, lang: Language) => {
    if (!speechEnabled || !window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);

    const langCodes: Record<Language, string> = {
      en: 'en-IN',
      mr: 'mr-IN',
      hi: 'hi-IN',
      gu: 'gu-IN',
      ta: 'ta-IN',
      kn: 'kn-IN',
      es: 'es-ES',
    };
    utterance.lang = langCodes[lang] || 'en-IN';
    utterance.rate = 0.95; // Friendly spoken pace

    window.speechSynthesis.speak(utterance);
  };

  // Toggle voice listening
  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      window.speechSynthesis?.cancel();
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        setIsListening(false);
      }
    }
  };

  // Send message to Gemini server-side AI API
  const handleSendMessage = async (queryText?: string) => {
    const textToSend = queryText || inputText;
    if (!textToSend.trim() || isProcessing) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      sender: 'user',
      text: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsProcessing(true);

    try {
      const res = await fetch('/api/ai/voice-guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userQuery: textToSend.trim(),
          language,
          currentStep,
          printerStatus,
          kioskId,
        }),
      });

      const data = await res.json();
      const reply = data.replyText || 'I am ready to help you with printing your documents.';

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        sender: 'assistant',
        text: reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Speak aloud in native language
      if (speechEnabled) {
        speakText(reply, language);
      }
    } catch (err) {
      const fallbackReply = 'Please follow the on-screen steps or ask the desk operator for assistance.';
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          text: fallbackReply,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const quickQuestions = [
    t.q1 || 'How do I print my document?',
    t.q2 || 'Where do I find my OTP?',
    t.q3 || 'Is my document private and safe?',
    t.q4 || 'What is the printing price?',
  ];

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg h-[640px] flex flex-col justify-between shadow-2xl overflow-hidden text-slate-100">
        {/* ASSISTANT HEADER */}
        <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">{t.voiceTitle}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Gemini 3.8
                </span>
              </div>
              <p className="text-[11px] text-slate-400">{t.voiceSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Speech Mute / Unmute Toggle */}
            <button
              onClick={() => {
                setSpeechEnabled(!speechEnabled);
                if (speechEnabled) window.speechSynthesis?.cancel();
              }}
              className={`p-2 rounded-xl border text-xs transition ${
                speechEnabled
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
              title={speechEnabled ? 'Mute Voice' : 'Enable Voice'}
            >
              {speechEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Close Button */}
            <button
              onClick={() => {
                window.speechSynthesis?.cancel();
                onClose();
              }}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* CHAT MESSAGES LOG */}
        <div className="flex-1 p-5 overflow-y-auto space-y-3 text-xs">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 leading-relaxed shadow-sm ${
                  msg.sender === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-slate-800 text-slate-200 border border-slate-700/60 rounded-bl-none'
                }`}
              >
                {msg.text}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 px-1">{msg.timestamp}</span>
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-center gap-2 text-xs text-blue-400 bg-slate-800/60 px-4 py-2.5 rounded-2xl max-w-[70%] border border-slate-700/60 animate-pulse">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>{t.processingVoice}</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* SUGGESTED QUICK QUESTIONS */}
        <div className="px-5 py-2 border-t border-slate-800/60 bg-slate-950/40">
          <span className="text-[10px] text-slate-400 block mb-1.5 font-medium">{t.suggestedQuestions}</span>
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {quickQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => handleSendMessage(q)}
                disabled={isProcessing}
                className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-[11px] whitespace-nowrap transition"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* VOICE INPUT & TEXT BAR */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center gap-2">
          {/* Microphone Tap to Speak Button */}
          {voiceSupported && (
            <button
              onClick={toggleListening}
              className={`p-3 rounded-2xl transition shadow-lg ${
                isListening
                  ? 'bg-rose-500 text-white animate-pulse ring-4 ring-rose-500/30'
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-600/30'
              }`}
              title={isListening ? 'Stop' : t.tapToSpeak}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}

          {/* Text Input */}
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={isListening ? t.listening : 'Ask a question or tap mic...'}
            disabled={isProcessing}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />

          {/* Send Button */}
          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isProcessing}
            className={`p-3 rounded-2xl transition ${
              !inputText.trim() || isProcessing
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
            }`}
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
