import { GoogleGenAI } from '@google/genai';

// Initialize Gemini client with aistudio-build header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface VoiceGuideRequest {
  userQuery: string;
  language: string; // 'en' | 'mr' | 'hi' | 'gu' | 'ta' | 'kn' | 'es'
  currentStep?: string; // 'HOME' | 'SCAN_QR' | 'ENTER_OTP' | 'PAYMENT_PENDING' | 'PRINTING' | 'COMPLETED'
  printerStatus?: string;
  kioskId?: string;
}

export interface VoiceGuideResponse {
  replyText: string;
  suggestedAction?: string;
  language: string;
  audioBase64?: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  mr: 'Marathi (मराठी)',
  hi: 'Hindi (हिंदी)',
  gu: 'Gujarati (ગુજરાતી)',
  ta: 'Tamil (தமிழ்)',
  kn: 'Kannada (ಕನ್ನಡ)',
  es: 'Spanish (Español)',
};

/**
 * Generates spoken/conversational guidance for kiosk users in their native language
 */
export async function getGeminiVoiceGuidance(
  params: VoiceGuideRequest
): Promise<VoiceGuideResponse> {
  const { userQuery, language = 'en', currentStep = 'HOME', printerStatus = 'READY', kioskId = 'KSK-001' } = params;

  const targetLang = LANGUAGE_NAMES[language] || 'English';

  const systemInstruction = `
You are the friendly, helpful, and patient Voice Assistant for the "Smart Print Kiosk" (${kioskId}).
Your job is to guide customers—many of whom may have limited technical knowledge or are elderly—through using this 100% touchless self-service printing terminal.

Key Touchless Concept:
- Customers DO NOT need to touch the kiosk screen at all!
- Everything is operated from their own smartphone.
- 1. Customer scans the dynamic QR code on the kiosk screen with their phone camera.
- 2. On their phone: Enter basic details, upload document (PDF, Word, PPT, Image), and configure settings (A4/A3, B&W ₹2, Color ₹10, Duplex, Copies).
- 3. On their phone: Instant authentication pairs with the kiosk hands-free.
- 4. Dynamic Payment QR: A large dynamic UPI / Payment QR code appears on the kiosk screen. Customer simply scans it to pay ₹{amount}.
- 5. Mobile Remote Control: While printing, the customer can PAUSE, RESUME, or CANCEL the print job right from their phone!
- 6. Privacy: Uploaded files are automatically wiped after printing.

Terminal Context:
- Current Kiosk Screen: ${currentStep}
- Kiosk Printer Hardware Status: ${printerStatus}

Rules:
1. Always respond in the requested language: ${targetLang}.
2. Keep your answer brief, warm, clear, and easy to understand (1 to 3 short sentences).
3. Emphasize that they can do everything comfortably from their phone without touching the kiosk.
4. If printer status is OUT_OF_PAPER, PAPER_JAM, or ERROR, advise them calmly that operator support is on the way.
`.trim();

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: userQuery,
      config: {
        systemInstruction,
        temperature: 0.3,
        maxOutputTokens: 200,
      },
    });

    const replyText = response.text?.trim() || getFallbackGuidance(userQuery, language, currentStep);

    return {
      replyText,
      language,
    };
  } catch (error) {
    console.warn('Gemini API call returned error or offline, using localized fallback:', error);
    return {
      replyText: getFallbackGuidance(userQuery, language, currentStep),
      language,
    };
  }
}

/**
 * Localized instant fallback guidance when offline or network drops
 */
function getFallbackGuidance(query: string, lang: string, step: string): string {
  const q = query.toLowerCase();

  if (lang === 'mr') {
    if (q.includes('otp') || q.includes('ओटीपी') || step === 'ENTER_OTP') {
      return 'तुमच्या मोबाईल स्क्रीनवर दिसणारा ६-अंकी OTP किऑस्कच्या मोठ्या बटनांवर टाईप करा आणि पडताळणी बटण दाबा.';
    }
    if (q.includes('कसे') || q.includes('print') || q.includes('प्रिंट')) {
      return 'स्क्रीनवरील क्यूआर कोड तुमच्या मोबाईल कॅमेऱ्याने स्कॅन करा, फाईल अपलोड करा, आणि आलेला ६-अंकी OTP येथे टाका.';
    }
    if (q.includes('सुरक्षित') || q.includes('प्रायव्हसी')) {
      return 'तुमचे दस्तऐवज प्रिंट झाल्यानंतर तात्काळ आणि कायमचे हटवले जाते. तुमची माहिती पूर्णपणे सुरक्षित आहे.';
    }
    return 'कृपया स्क्रीनवरील सूचनांचे पालन करा. कोणत्याही मदतीसाठी डेस्क ऑपरेटरशी संपर्क साधा.';
  }

  if (lang === 'hi') {
    if (q.includes('otp') || q.includes('ओटीपी') || step === 'ENTER_OTP') {
      return 'अपने फ़ोन स्क्रीन पर दिख रहे 6-अंकों के OTP को कियोस्क स्क्रीन पर डालें और सत्यापित करें बटन दबाएं।';
    }
    if (q.includes('प्रिंट') || q.includes('कैसे')) {
      return 'स्क्रीन पर दिख रहे क्यूआर कोड को अपने फ़ोन से स्कैन करें, फ़ाइल अपलोड करें, और प्राप्त OTP यहाँ दर्ज करें।';
    }
    if (q.includes('सुरक्षा') || q.includes('प्राइवेट')) {
      return 'आपका दस्तावेज़ प्रिंट होने के तुरंत बाद सुरक्षित रूप से मिटा दिया जाता है। यह पूर्णतः सुरक्षित है।';
    }
    return 'कृपया स्क्रीन पर दिए निर्देशों का पालन करें। किसी भी सहायता के लिए ऑपरेटर से संपर्क करें।';
  }

  if (lang === 'gu') {
    return 'સ્ક્રીન પર દર્શાવેલ QR કોડ તમારા ફોનથી સ્કેન કરો, દસ્તાવેજ અપલોડ કરો અને ફોન પર મળેલ 6-અંકનો OTP અહીં દાખલ કરો.';
  }

  if (lang === 'ta') {
    return 'உங்கள் தொலைபேசியில் QR குறியீட்டை ஸ்கேன் செய்து, ஆவணத்தை பதிவேற்றி, பெறப்பட்ட 6 இலக்க OTP-ஐ திரையில் உள்ளிடவும்.';
  }

  if (lang === 'kn') {
    return 'ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ QR ಕೋಡ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ, ಡಾಕ್ಯುಮೆಂಟ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ಮತ್ತು 6 ಅಂಕಿಯ OTP ಅನ್ನು ನಮೂದಿಸಿ.';
  }

  // English fallback
  if (q.includes('otp') || step === 'ENTER_OTP') {
    return 'Enter the 6-digit OTP displayed on your phone using the large touch keypad on screen and press Verify.';
  }
  if (q.includes('private') || q.includes('safe') || q.includes('privacy')) {
    return 'Your document is completely secure and automatically erased from our system right after printing.';
  }
  return 'Scan the QR code on screen with your phone camera to upload your document, then enter the 6-digit OTP to print.';
}
