const SupportChat = require('../models/SupportChat.model');
const { AppError } = require('../middlewares/errorHandler');

// ─── Auto-reply knowledge base ───────────────────────────────────────────────
const AUTO_REPLIES = [
  {
    keywords: ['hello', 'hi', 'hey', 'namaste', 'hii', 'helo', 'hiya', 'sup', 'yo', 'good morning', 'good afternoon', 'good evening', 'morning', 'evening'],
    reply: "Hello! 👋 Welcome to Quick Chat support!\n\nQuick Chat (quickchatindia.com) is India's platform for instant audio/video/chat consultations with experts.\n\nHow can I help you today? You can ask about:\n• Getting started & registration\n• Consultations & calls\n• Payments & wallet\n• Withdrawals & earnings\n• Reports & blocking\n• Technical issues",
  },
  {
    keywords: ['what is quick chat', 'about quick chat', 'what is this', 'quickchat', 'website', 'platform', 'app'],
    reply: "Quick Chat (quickchatindia.com) is India's expert consultation platform.\n\n📱 Available on: Android & iOS apps + Web\n🎯 Services: Audio calls, Video calls, Chat consultations\n💰 Billing: Per-minute billing based on provider's rate\n🆓 Free trial: First minute FREE for new users\n💳 Payments: PhonePe, UPI, Debit/Credit cards\n\nConnect with experts in astrology, legal, medical, finance, and more!",
  },
  {
    keywords: ['register', 'sign up', 'signup', 'create account', 'new account', 'join'],
    reply: "To register on Quick Chat:\n1. Visit quickchatindia.com or download the app\n2. Click 'Get Started'\n3. Enter your mobile number\n4. Verify with OTP\n5. Fill in your profile details\n\n✅ Registration is FREE and takes less than 2 minutes!\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['login', 'log in', 'signin', 'sign in', 'password', 'forgot', 'otp', 'cant login'],
    reply: "To login to Quick Chat:\n1. Click 'Login' on the homepage\n2. Enter your registered mobile number\n3. Enter the OTP sent to your mobile\n\n🔑 Forgot password? Use 'Forgot Password' on the login page.\n📞 OTP not received? Check your network or try again after 60 seconds.\n📧 Still stuck? Email: Quickchat2026@gmail.com",
  },
  {
    keywords: ['consultation', 'call', 'video', 'audio', 'connect', 'talk', 'start call', 'book'],
    reply: "To start a consultation on Quick Chat:\n1. Browse providers on 'Find Expert' page\n2. Click on a provider's profile\n3. Choose call type: 🎵 Audio / 📹 Video / 💬 Chat\n4. Ensure you have sufficient wallet balance\n5. Click 'Start Consultation'\n\n💡 First minute is FREE for new users!\n⏱️ Billing is per-minute based on provider's rate\n📱 Works on web and mobile app",
  },
  {
    keywords: ['payment', 'pay', 'wallet', 'recharge', 'add money', 'balance', 'topup', 'phonepe', 'upi'],
    reply: "To add money to your Quick Chat wallet:\n1. Go to 'Wallet' in your profile\n2. Click 'Add Money'\n3. Enter the amount (minimum ₹50)\n4. Pay via PhonePe, UPI, or Debit/Credit card\n\n💳 Payment methods: PhonePe, UPI, Cards\n💰 Minimum recharge: ₹50\n⚡ Payments are processed instantly\n\nFor payment issues, email: Quickchat2026@gmail.com",
  },
  {
    keywords: ['refund', 'money back', 'charge', 'deducted', 'wrong charge', 'overcharged'],
    reply: "For refund requests on Quick Chat:\n• Refunds are processed within 5-7 business days\n• Contact us with your transaction ID\n• Refunds go back to your original payment method\n\n📧 Email: Quickchat2026@gmail.com\n📝 Include: Your mobile number, transaction ID, and issue description\n\nFor wallet balance issues, we'll investigate within 24 hours.",
  },
  {
    keywords: ['report', 'block', 'inappropriate', 'harassment', 'spam', 'abuse', 'complaint'],
    reply: "To report or block a user on Quick Chat:\n1. After a consultation, you'll see a rating screen\n2. Give a 1-star rating to show the report option\n3. Select 'Report Only' or 'Report & Block'\n4. Choose a reason and add description\n\n🛡️ All reports are reviewed by our admin team within 24 hours.\n⚠️ Repeated violations result in account suspension.\n📧 Urgent: Quickchat2026@gmail.com",
  },
  {
    keywords: ['provider', 'expert', 'advisor', 'become', 'earn', 'offer service', 'astrologer', 'consultant'],
    reply: "To become a provider on Quick Chat:\n1. Go to your profile settings\n2. Click 'Become a Provider'\n3. Fill in your expertise and set your per-minute rate\n4. Upload required documents\n5. Wait for admin approval (24-48 hours)\n\n💰 Providers earn per minute of consultation\n💸 Minimum withdrawal: ₹200\n⏱️ Payouts within 24 hours\n📧 Questions: Quickchat2026@gmail.com",
  },
  {
    keywords: ['withdraw', 'withdrawal', 'payout', 'earnings', 'bank', 'transfer money'],
    reply: "To withdraw your earnings from Quick Chat:\n1. Go to 'Wallet' > 'Withdraw'\n2. Enter your bank account details\n3. Enter the amount to withdraw\n4. Submit the request\n\n💰 Minimum withdrawal: ₹200\n⏱️ Processing time: 24 hours\n🏦 Transferred directly to your bank account\n\n📧 Withdrawal issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['free', 'trial', 'free minute', 'first call', 'free consultation'],
    reply: "Quick Chat offers a FREE trial for new users! 🎉\n\n✅ First consultation: First minute is FREE\n✅ No credit card required to start\n✅ Available for all new registered users\n\nJust find a provider and start your first consultation to enjoy the free trial.\n\n🌐 Visit: quickchatindia.com",
  },
  {
    keywords: ['price', 'rate', 'cost', 'how much', 'charges', 'fee', 'per minute'],
    reply: "Quick Chat pricing:\n\n💰 Billing: Per-minute based on each provider's rate\n🆓 Free trial: First minute FREE for new users\n💳 Minimum wallet recharge: ₹50\n\nEach provider sets their own per-minute rate, visible on their profile before you start a call.\n\n📱 Download the app or visit quickchatindia.com to browse providers and their rates.",
  },
  {
    keywords: ['download', 'android', 'ios', 'mobile app', 'play store', 'app store'],
    reply: "Quick Chat is available on:\n\n📱 Android: Available on Google Play Store\n🍎 iOS: Available on Apple App Store\n🌐 Web: quickchatindia.com\n\nSearch 'Quick Chat India' on your app store to download.\n\n📧 App issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['notification', 'alert', 'push', 'email notification'],
    reply: "To manage notifications on Quick Chat:\n1. Go to Profile > Settings\n2. Toggle notification preferences\n3. Enable/disable push, email, and SMS notifications\n\n📱 Make sure to allow notifications in your device/browser settings for call alerts.\n\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['delete', 'deactivate', 'close account', 'remove account'],
    reply: "To delete or deactivate your Quick Chat account:\n1. Go to Profile > Settings\n2. Scroll to 'Account' section\n3. Click 'Deactivate Account'\n\n⚠️ Account deletion is permanent and cannot be undone.\n📅 Your data will be removed within 30 days.\n\n📧 Need help? Quickchat2026@gmail.com",
  },
  {
    keywords: ['technical', 'error', 'bug', 'not working', 'issue', 'problem', 'crash', 'loading', 'slow'],
    reply: "For technical issues on Quick Chat:\n1. Try refreshing the page or restarting the app\n2. Clear browser cache and cookies\n3. Check your internet connection\n4. Try a different browser (Chrome recommended)\n5. Update the app to the latest version\n\n🌐 Website: quickchatindia.com\n📧 Technical support: Quickchat2026@gmail.com\n\nPlease describe your issue in detail and we'll escalate to our tech team.",
  },
  {
    keywords: ['rating', 'review', 'feedback', 'star'],
    reply: "After each consultation on Quick Chat:\n• Rate the provider (1-5 stars)\n• Leave a written review\n• Report if needed (1-star auto-shows report option)\n\n⭐ Your feedback helps maintain quality on the platform and helps other users choose the right expert.",
  },
  {
    keywords: ['contact', 'support', 'help', 'human', 'agent', 'talk to someone', 'email'],
    reply: "You can reach Quick Chat support through:\n\n📧 Email: Quickchat2026@gmail.com\n💬 Live Chat: You're already chatting with us!\n🌐 Website: quickchatindia.com\n\nOur support team reviews all messages and will respond shortly. For urgent issues, email us directly.",
  },
  {
    keywords: ['profile', 'edit profile', 'update profile', 'change name', 'change photo', 'avatar', 'bio'],
    reply: "To update your Quick Chat profile:\n1. Go to your Profile page\n2. Click 'Edit Profile'\n3. Update your name, photo, bio, or other details\n4. Click 'Save Changes'\n\n📸 Supported photo formats: JPG, PNG (max 5MB)\n💡 A complete profile helps users trust you more!\n\n📧 Profile issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['kyc', 'verification', 'verify', 'document', 'id proof', 'identity'],
    reply: "For KYC / Identity Verification on Quick Chat:\n1. Go to Profile > Verification\n2. Upload a valid government ID (Aadhaar, PAN, Passport)\n3. Submit for review\n\n⏱️ Verification takes 24-48 hours\n✅ Verified providers get a trust badge on their profile\n🔒 Your documents are stored securely\n\n📧 KYC issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['call failed', 'call dropped', 'disconnected', 'call not connecting', 'call quality', 'poor quality', 'no sound', 'no video'],
    reply: "If your call dropped or failed on Quick Chat:\n\n1. Check your internet connection (min 2 Mbps recommended)\n2. Restart the app or refresh the browser\n3. Allow microphone & camera permissions\n4. Try switching between WiFi and mobile data\n5. Close other apps using camera/mic\n\n📱 For call quality issues, a stable WiFi connection works best.\n📧 Persistent issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['mic', 'microphone', 'camera', 'permission', 'allow', 'blocked'],
    reply: "To fix microphone or camera permission issues:\n\n🌐 On Browser:\n1. Click the lock icon in the address bar\n2. Set Camera & Microphone to 'Allow'\n3. Refresh the page\n\n📱 On Mobile App:\n1. Go to Phone Settings > Apps > Quick Chat\n2. Enable Camera & Microphone permissions\n3. Restart the app\n\n📧 Still not working? Quickchat2026@gmail.com",
  },
  {
    keywords: ['transaction', 'history', 'statement', 'invoice', 'receipt', 'past payment'],
    reply: "To view your transaction history on Quick Chat:\n1. Go to your Profile\n2. Click 'Wallet' or 'Transaction History'\n3. View all past payments, recharges, and deductions\n\n📄 You can filter by date range\n💡 Each consultation shows duration, amount, and provider name\n\n📧 Transaction disputes: Quickchat2026@gmail.com",
  },
  {
    keywords: ['schedule', 'appointment', 'book later', 'future call', 'availability'],
    reply: "Quick Chat currently supports instant consultations.\n\n⚡ How it works:\n• Browse available providers in real-time\n• Providers show 'Available' or 'Busy' status\n• Start a call instantly when a provider is available\n\n🔔 You can follow a provider to get notified when they come online.\n\n📧 Questions: Quickchat2026@gmail.com",
  },
  {
    keywords: ['follow', 'favourite', 'favorite', 'save provider', 'bookmark'],
    reply: "To follow or save a provider on Quick Chat:\n1. Open the provider's profile\n2. Click the ❤️ or 'Follow' button\n3. Find them in your 'Favourites' list anytime\n\n🔔 You'll get notified when your favourite providers come online!\n\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['language', 'hindi', 'english', 'regional', 'tamil', 'telugu', 'marathi', 'bengali'],
    reply: "Quick Chat supports consultations in multiple languages!\n\n🗣️ Available languages include:\n• Hindi, English\n• Tamil, Telugu, Kannada\n• Marathi, Bengali, Gujarati\n• And many more regional languages\n\nFilter providers by language on the 'Find Expert' page to find someone who speaks your language.\n\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['category', 'astrology', 'legal', 'doctor', 'medical', 'finance', 'tarot', 'vastu', 'numerology', 'yoga'],
    reply: "Quick Chat has experts across many categories:\n\n🔮 Astrology & Tarot\n⚖️ Legal Advice\n🏥 Medical & Health\n💰 Finance & Investment\n🏠 Vastu & Feng Shui\n🔢 Numerology\n🧘 Yoga & Wellness\n💼 Career Guidance\n❤️ Relationship Advice\n\nBrowse all categories on quickchatindia.com or the app!\n\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['suspend', 'suspended', 'banned', 'account blocked', 'account disabled', 'cant access'],
    reply: "If your Quick Chat account has been suspended:\n\n⚠️ Accounts are suspended for:\n• Violating community guidelines\n• Multiple user reports\n• Fraudulent activity\n\n📧 To appeal, email us at: Quickchat2026@gmail.com\nInclude: Your registered mobile number and reason for appeal.\n\nOur team reviews appeals within 48 hours.",
  },
  {
    keywords: ['privacy', 'data', 'personal information', 'gdpr', 'data protection', 'secure'],
    reply: "Quick Chat takes your privacy seriously 🔒\n\n• We use secure HTTPS for all data transmission\n• We never share your personal data with third parties\n• You can request data deletion anytime\n• Payments are processed via secure PCI-compliant gateways\n\n⚠️ Note: Calls are NOT end-to-end encrypted — they pass through our secure servers.\n\n📄 Read our full Privacy Policy at quickchatindia.com/privacy\n\n📧 Privacy concerns: Quickchat2026@gmail.com",
  },
  {
    keywords: ['coupon', 'promo', 'discount', 'offer', 'cashback', 'code', 'voucher'],
    reply: "Quick Chat occasionally offers promo codes and cashback deals! 🎁\n\n💡 How to apply a promo code:\n1. Go to Wallet > Add Money\n2. Enter your promo code at checkout\n3. Discount is applied automatically\n\n📢 Follow us on social media for the latest offers!\n🌐 quickchatindia.com\n\n📧 Promo issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['review', 'feedback provider', 'rate provider', 'bad experience', 'good experience'],
    reply: "To leave a review for a provider on Quick Chat:\n1. After the consultation ends, a rating screen appears\n2. Select 1-5 stars\n3. Write your review (optional)\n4. Submit\n\n⭐ Reviews are public and help other users choose the right expert.\n🚩 For bad experiences, use the Report option (1-star shows report button).\n\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['chat consultation', 'text chat','chat', 'messaging', 'text only'],
    reply: "Quick Chat supports text-based chat consultations! 💬\n\nHow to start a chat consultation:\n1. Find a provider who offers 'Chat' service\n2. Click 'Start Chat Consultation'\n3. Type your messages in real-time\n\n💰 Chat consultations are also billed per minute\n🆓 First minute free for new users\n\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['thank', 'thanks', 'bye', 'goodbye', 'ok', 'okay', 'got it', 'understood', 'great', 'perfect', 'done', 'solved', 'resolved'],
    reply: "You're welcome! 😊 Happy to help!\n\nIf you need anything else, feel free to ask. Our support team at Quickchat2026@gmail.com is also available for further assistance.\n\n🌐 quickchatindia.com",
  },

  // ── Short / casual phrases ──────────────────────────────────────────────────
  {
    keywords: ['not working', 'not loading', 'page not loading', 'blank screen', 'white screen', 'stuck', 'frozen'],
    reply: "Try these quick fixes:\n1. Refresh the page (Ctrl+R)\n2. Clear browser cache\n3. Try Chrome or Firefox\n4. Check your internet\n\n📧 Still stuck? Quickchat2026@gmail.com",
  },
  {
    keywords: ['money deducted', 'money gone', 'balance gone', 'wallet empty', 'amount deducted'],
    reply: "If money was deducted unexpectedly:\n• Check your Transaction History in Wallet\n• Each consultation deducts per minute used\n• Minimum 1 minute is charged if call connected\n\n📧 Share your mobile number + transaction ID to: Quickchat2026@gmail.com — we'll investigate within 24 hrs.",
  },
  {
    keywords: ['call not connecting', 'call not starting', 'call failed', 'cant start call', 'call button not working'],
    reply: "Call not connecting? Try this:\n1. Check wallet balance (must be > provider's per-minute rate)\n2. Allow mic & camera permissions\n3. Check internet speed (min 2 Mbps)\n4. Refresh and try again\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['otp not received', 'otp not coming', 'didnt get otp', 'no otp', 'resend otp'],
    reply: "OTP not received?\n• Wait 60 seconds then tap 'Resend OTP'\n• Check if your number is correct\n• Check SMS inbox and spam folder\n• Make sure DND is not active on your number\n\n📧 Still no OTP? Quickchat2026@gmail.com",
  },
  {
    keywords: ['how to pay', 'payment method', 'how to add money', 'add balance', 'top up'],
    reply: "To add money:\n1. Profile → Wallet → Add Money\n2. Enter amount (min ₹50)\n3. Pay via PhonePe / UPI / Card\n\n⚡ Credited instantly!\n📧 Payment issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['minimum recharge', 'minimum amount', 'min recharge', 'least amount'],
    reply: "Minimum wallet recharge on Quick Chat is ₹50.\n\nYou can add any amount above ₹50 via PhonePe, UPI, or Debit/Credit card.",
  },
  {
    keywords: ['minimum withdrawal', 'min withdraw', 'least withdrawal', 'how much to withdraw'],
    reply: "Minimum withdrawal amount is ₹200.\n\nWithdrawals are processed within 24 hours directly to your bank account.",
  },
  {
    keywords: ['how long', 'how many days', 'when will', 'processing time', 'how much time'],
    reply: "Processing times on Quick Chat:\n• Wallet recharge: Instant\n• Withdrawal to bank: 24 hours\n• Refunds: 5-7 business days\n• KYC verification: 24-48 hours\n• Account appeal: 48 hours\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['provider offline', 'provider not available', 'expert not online', 'no provider', 'all busy'],
    reply: "If your preferred provider is offline:\n• Check back later — providers set their own hours\n• Follow them to get notified when they come online\n• Browse other available providers in the same category\n\n🌐 quickchatindia.com",
  },
  {
    keywords: ['how to follow', 'follow provider', 'save expert', 'favourite provider', 'notify me'],
    reply: "To follow a provider:\n1. Open their profile\n2. Tap the ❤️ Follow button\n3. You'll get a notification when they go online!\n\nFind your followed providers under 'Favourites' in your profile.",
  },
  {
    keywords: ['change number', 'change mobile', 'update phone', 'new number', 'change email'],
    reply: "To change your registered mobile number or email:\n📧 Email us at Quickchat2026@gmail.com with:\n• Your current registered number\n• New number/email\n• A valid ID proof\n\nOur team will update it within 24 hours.",
  },
  {
    keywords: ['how to report', 'report user', 'report provider', 'report someone'],
    reply: "To report someone:\n1. After the call, tap 1 star on the rating screen\n2. The report option appears automatically\n3. Choose 'Report Only' or 'Report & Block'\n4. Select reason + add details\n\n🛡️ Reviewed by admin within 24 hours.",
  },
  {
    keywords: ['how to block', 'block user', 'block provider', 'block someone', 'blocked'],
    reply: "To block someone on Quick Chat:\n1. After a consultation, give 1-star rating\n2. Select 'Report & Block'\n3. The user is blocked — they won't appear in your searches\n\n📧 Issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['encryption', 'end to end', 'e2e', 'secure call', 'private call', 'is it safe', 'safe to use', 'data safe', 'call private'],
    reply: "🔒 Privacy & Security on Quick Chat:\n\nQuick Chat uses secure HTTPS and encrypted data transmission for all communications.\n\n⚠️ Please note: Quick Chat does NOT currently offer end-to-end encryption (E2EE) for calls and chats. Calls are routed through our secure servers.\n\n• We do NOT share your data with third parties\n• Payments are PCI-compliant\n• Personal data is stored securely\n\n📄 Privacy Policy: quickchatindia.com/privacy\n📧 Concerns: Quickchat2026@gmail.com",
  },
  {
    keywords: ['is my data safe', 'who can see', 'can admin see', 'admin access', 'data privacy'],
    reply: "Your data on Quick Chat:\n• Admins can access chats only for moderation/support purposes\n• We do NOT sell your data\n• Calls are NOT end-to-end encrypted — they pass through our servers\n• You can request data deletion anytime\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['how does billing work', 'billing', 'how am i charged', 'when charged', 'charge per minute'],
    reply: "Quick Chat billing works like this:\n• You're charged per minute of the consultation\n• Rate is set by the provider (visible on their profile)\n• Amount is deducted from your wallet in real-time\n• First minute is FREE for new users\n• Minimum ₹50 wallet balance needed to start\n\n📧 Billing queries: Quickchat2026@gmail.com",
  },
  {
    keywords: ['who are providers', 'who are experts', 'are they verified', 'real experts', 'trusted'],
    reply: "Quick Chat providers are verified experts! ✅\n\n• All providers go through admin approval\n• KYC/document verification required\n• Verified badge shown on their profile\n• User ratings and reviews are public\n• Reported providers are reviewed and can be suspended\n\n🌐 Browse experts at quickchatindia.com",
  },
  {
    keywords: ['can i use without account', 'guest', 'without login', 'no account', 'without register'],
    reply: "You need a Quick Chat account to start consultations.\n\nRegistration is FREE and takes under 2 minutes:\n1. Visit quickchatindia.com\n2. Click 'Get Started'\n3. Enter mobile number + OTP\n\n🆓 First minute of your first call is FREE!",
  },
  {
    keywords: ['how many calls', 'call limit', 'daily limit', 'max calls', 'unlimited'],
    reply: "There's no limit on the number of consultations on Quick Chat! 🎉\n\nYou can make as many calls as you want as long as you have wallet balance.\n\n💰 Minimum recharge: ₹50\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['referral', 'refer', 'invite friend', 'refer and earn', 'referral code'],
    reply: "Quick Chat has a referral program! 🎁\n\nTo refer a friend:\n1. Go to Profile > Refer & Earn\n2. Share your referral code or link\n3. Earn bonus wallet credits when they register and make their first call!\n\n📧 Referral issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['what categories', 'type of experts', 'what services', 'what can i ask', 'topics'],
    reply: "Quick Chat has experts in many categories:\n\n🔮 Astrology & Tarot\n⚖️ Legal Advice\n🏥 Health & Medical\n💰 Finance & Investment\n🏠 Vastu & Feng Shui\n🔢 Numerology\n🧘 Yoga & Wellness\n💼 Career Guidance\n❤️ Relationship Advice\n📚 Education & Tutoring\n\n🌐 Browse all at quickchatindia.com",
  },
  {
    keywords: ['how to end call', 'end consultation', 'stop call', 'disconnect call', 'hang up'],
    reply: "To end a consultation on Quick Chat:\n• Tap the red 'End Call' button during the call\n• Billing stops immediately when the call ends\n• You'll see a summary with duration and amount charged\n• A rating screen appears after the call\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['provider not responding', 'no response', 'provider ignored', 'call not answered', 'missed call'],
    reply: "If a provider didn't answer your call:\n• You are NOT charged if the call wasn't answered\n• Try calling again or choose another available provider\n• You can leave a review mentioning the missed call\n\n📧 Issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['wrong provider', 'connected to wrong person', 'mistake', 'wrong call'],
    reply: "If you were connected to the wrong provider:\n• End the call immediately\n• You'll only be charged for the time connected\n• Report the issue to: Quickchat2026@gmail.com\n• Include: your mobile number, consultation ID, and what happened\n\nWe'll review and process a refund if applicable.",
  },
  {
    keywords: ['how to search', 'find expert', 'search provider', 'filter', 'browse'],
    reply: "To find an expert on Quick Chat:\n1. Go to 'Find Expert' page\n2. Use filters: Category, Language, Rating, Price\n3. See who's online right now (green dot = available)\n4. Click their profile to view details and start a call\n\n🌐 quickchatindia.com",
  },

  // ── Ultra-short / typo-friendly phrases ────────────────────────────────────
  {
    keywords: ['cant pay', 'payment fail', 'payment failed', 'payment not working', 'payment error', 'transaction failed'],
    reply: "Payment failed? Try this:\n1. Check your internet connection\n2. Make sure your UPI/card details are correct\n3. Try a different payment method\n4. Retry after 2-3 minutes\n\n📧 Still failing? Share your transaction ID to: Quickchat2026@gmail.com",
  },
  {
    keywords: ['app crash', 'app closes', 'app closing', 'keeps crashing', 'force close', 'app stop'],
    reply: "App crashing? Try:\n1. Force close and reopen the app\n2. Update to the latest version from Play Store / App Store\n3. Restart your phone\n4. Reinstall the app if issue persists\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['black screen', 'video black', 'camera black', 'no camera', 'camera not showing'],
    reply: "Black screen during video call?\n1. Allow camera permission in phone settings\n2. Close other apps using the camera\n3. Switch camera (front/back) and switch back\n4. Rejoin the call\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['no internet', 'internet issue', 'wifi issue', 'network issue', 'connection issue', 'poor network'],
    reply: "Connection issues during a call?\n• Minimum 2 Mbps internet speed recommended\n• Switch from WiFi to mobile data (or vice versa)\n• Move closer to your router\n• Close background apps consuming bandwidth\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['cant hear', 'no audio', 'audio not working', 'sound not coming', 'voice not coming', 'cant hear provider'],
    reply: "Can't hear audio during a call?\n1. Check your phone volume — turn it up\n2. Make sure you haven't muted yourself\n3. Check if headphones are connected properly\n4. Allow microphone permission\n5. Rejoin the call\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['muted', 'mic muted', 'they cant hear me', 'provider cant hear', 'my voice not going'],
    reply: "Provider can't hear you?\n1. Tap the mic icon to unmute yourself\n2. Check microphone permission is allowed\n3. Make sure no other app is using the mic\n4. Try using earphones with a built-in mic\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['how to rate', 'give rating', 'give review', 'rate after call', 'review after call'],
    reply: "To rate a provider after a call:\n• The rating screen appears automatically when the call ends\n• Select 1-5 stars\n• Optionally write a review\n• Tap Submit\n\n⭐ 1-star rating shows the Report option if needed.",
  },
  {
    keywords: ['wrong number', 'wrong mobile', 'registered wrong number', 'wrong phone number'],
    reply: "Registered with the wrong number?\n📧 Email us at Quickchat2026@gmail.com with:\n• Your wrong number\n• Correct number\n• A valid ID proof\n\nWe'll update it within 24 hours.",
  },
  {
    keywords: ['forgot email', 'dont remember email', 'lost access', 'cant access account', 'account recovery'],
    reply: "Can't access your account?\n📧 Email us at Quickchat2026@gmail.com with:\n• Your registered mobile number\n• Any transaction ID or details to verify identity\n\nOur team will help you recover access within 24 hours.",
  },
  {
    keywords: ['how to register as provider', 'provider registration', 'apply as provider', 'provider signup', 'join as expert'],
    reply: "To register as a provider on Quick Chat:\n1. Login to your account\n2. Go to Profile > Become a Provider\n3. Fill in your expertise, bio, and per-minute rate\n4. Upload KYC documents\n5. Submit for admin approval (24-48 hrs)\n\n💰 Earn per minute of consultation!\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['provider earnings', 'how much do providers earn', 'provider income', 'how providers get paid'],
    reply: "Provider earnings on Quick Chat:\n• You earn per minute of each consultation\n• Rate is set by you (visible on your profile)\n• Earnings accumulate in your wallet\n• Withdraw anytime (min ₹200)\n• Payouts in 2-3 business days\n\n📧 Earnings queries: Quickchat2026@gmail.com",
  },
  {
    keywords: ['what is wallet', 'wallet kya hai', 'how wallet works', 'wallet balance'],
    reply: "Quick Chat Wallet:\n• Your in-app balance used for consultations\n• Add money via PhonePe, UPI, or Card (min ₹50)\n• Balance is deducted per minute during calls\n• Providers receive earnings in their wallet\n• Withdraw to bank (min ₹200)\n\n📧 Quickchat2026@gmail.com",
  },
  {
    keywords: ['aadhaar', 'pan card', 'passport', 'id document', 'government id', 'upload document'],
    reply: "For KYC document upload on Quick Chat:\n• Accepted IDs: Aadhaar Card, PAN Card, Passport, Voter ID\n• Go to Profile > Verification > Upload Document\n• Make sure the document is clear and readable\n• Verification takes 24-48 hours\n\n📧 KYC issues: Quickchat2026@gmail.com",
  },
  {
    keywords: ['social media', 'instagram', 'facebook', 'twitter', 'youtube', 'follow us'],
    reply: "Follow Quick Chat on social media for updates, offers, and tips!\n\n📸 Instagram: @quickchatindia\n📘 Facebook: Quick Chat India\n▶️ YouTube: Quick Chat India\n\n🌐 Website: quickchatindia.com\n📧 Support: Quickchat2026@gmail.com",
  },
  {
    keywords: ['terms', 'terms and conditions', 'terms of service', 'tos', 'conditions'],
    reply: "Quick Chat Terms & Conditions:\n📄 Read our full Terms of Service at: quickchatindia.com/terms\n\nKey points:\n• Users must be 18+ to use the platform\n• Providers must complete KYC verification\n• Misuse leads to account suspension\n• Refunds subject to our refund policy\n\n📧 Questions: Quickchat2026@gmail.com",
  },
  {
    keywords: ['how to use', 'how does it work', 'explain', 'guide me', 'tutorial', 'steps'],
    reply: "Here's how Quick Chat works:\n\n1️⃣ Register with your mobile number (free)\n2️⃣ Add money to your wallet (min ₹50)\n3️⃣ Browse experts on 'Find Expert' page\n4️⃣ Start an Audio / Video / Chat consultation\n5️⃣ Get billed per minute (first minute FREE for new users)\n6️⃣ Rate the provider after the call\n\n🌐 quickchatindia.com",
  },
];

const getAutoReply = (message) => {
  const lower = message.toLowerCase();
  for (const entry of AUTO_REPLIES) {
    if (entry.keywords.some(kw => lower.includes(kw))) {
      return entry.reply;
    }
  }
  return "Thank you for reaching out! 🙏\n\nI've received your message and our support team will get back to you shortly.\n\nFor urgent issues, you can also email us at " + (process.env.EMAIL_USER || 'Quickchat2026@gmail.com');
};

// ─── Controllers ─────────────────────────────────────────────────────────────

// @desc  Start or get existing support chat
// @route POST /api/support/chat
// @access Public (user or guest)
const startChat = async (req, res, next) => {
  try {
    const { guestName, guestEmail, guestPhone, subject, firstMessage, type } = req.body;
    const userId = req.user?._id || null;

    // Find existing open chat for this user
    let chat = null;
    if (userId) {
      // Logged-in user — find by userId
      chat = await SupportChat.findOne({ user: userId, status: { $in: ['open', 'in_progress'] } });
    } else if (guestEmail) {
      // Guest — find by email so same person doesn't get a new chat every time
      chat = await SupportChat.findOne({ guestEmail, user: null, status: { $in: ['open', 'in_progress'] } });
    }

    if (!chat) {
      chat = await SupportChat.create({
        user: userId,
        guestName: userId ? undefined : guestName,
        guestEmail: userId ? undefined : guestEmail,
        guestPhone: userId ? undefined : (guestPhone || undefined),
        subject: subject || 'General Support',
        type: type || 'live_chat',
        messages: [],
        status: 'open',
      });
    }

    // Add first message if provided
    if (firstMessage) {
      chat.messages.push({ sender: 'user', message: firstMessage });
      chat.lastMessage = firstMessage;
      chat.lastMessageAt = new Date();
      chat.adminUnread += 1;

      // Auto-reply
      const autoReply = getAutoReply(firstMessage);
      chat.messages.push({ sender: 'bot', message: autoReply });

      await chat.save();
    }

    res.status(200).json({ success: true, data: chat });
  } catch (error) {
    next(error);
  }
};

// @desc  Send a message in support chat
// @route POST /api/support/chat/:chatId/message
// @access Public
const sendMessage = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const { message } = req.body;

    if (!message?.trim()) return next(new AppError('Message is required', 400));

    const chat = await SupportChat.findById(chatId);
    if (!chat) return next(new AppError('Chat not found', 404));

    // Add user message
    chat.messages.push({ sender: 'user', message: message.trim() });
    chat.lastMessage = message.trim();
    chat.lastMessageAt = new Date();
    chat.adminUnread += 1;

    // Auto-reply from bot
    const autoReply = getAutoReply(message);
    chat.messages.push({ sender: 'bot', message: autoReply });

    await chat.save();

    // Emit via socket if available
    const io = req.app?.get('io');
    if (io) {
      io.to(`support:${chatId}`).emit('support_message', {
        chatId,
        messages: chat.messages.slice(-2),
      });
      io.to('admin_support').emit('support_new_message', {
        chatId,
        lastMessage: message.trim(),
        adminUnread: chat.adminUnread,
      });
    }

    res.status(200).json({ success: true, data: chat.messages.slice(-2) });
  } catch (error) {
    next(error);
  }
};

// @desc  Get chat history
// @route GET /api/support/chat/:chatId
// @access Public
const getChatHistory = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const chat = await SupportChat.findById(chatId).populate('user', 'fullName email mobile');
    if (!chat) return next(new AppError('Chat not found', 404));
    res.status(200).json({ success: true, data: chat });
  } catch (error) {
    next(error);
  }
};

// @desc  Get user's own chat
// @route GET /api/support/my-chat
// @access Private
const getMyChat = async (req, res, next) => {
  try {
    const chat = await SupportChat.findOne({
      user: req.user._id,
      status: { $in: ['open', 'in_progress'] },
    });
    res.status(200).json({ success: true, data: chat || null });
  } catch (error) {
    next(error);
  }
};

// ─── Admin Controllers ────────────────────────────────────────────────────────

// @desc  Get all support chats (Admin)
// @route GET /api/support/admin/chats
// @access Private/Admin
const getAllChats = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = status ? { status } : {};

    const chats = await SupportChat.find(query)
      .populate('user', 'fullName email mobile profilePhoto')
      .sort({ lastMessageAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await SupportChat.countDocuments(query);
    const unreadTotal = await SupportChat.aggregate([
      { $group: { _id: null, total: { $sum: '$adminUnread' } } },
    ]);

    res.status(200).json({
      success: true,
      data: chats,
      unreadTotal: unreadTotal[0]?.total || 0,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    next(error);
  }
};

// @desc  Admin reply to a chat
// @route POST /api/support/admin/chats/:chatId/reply
// @access Private/Admin
const adminReply = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const { message } = req.body;

    if (!message?.trim()) return next(new AppError('Message is required', 400));

    const chat = await SupportChat.findById(chatId);
    if (!chat) return next(new AppError('Chat not found', 404));

    chat.messages.push({ sender: 'admin', message: message.trim() });
    chat.lastMessage = message.trim();
    chat.lastMessageAt = new Date();
    chat.status = 'in_progress';

    // Mark admin messages as read for user
    chat.messages.forEach(m => { if (m.sender !== 'user') m.isRead = true; });

    await chat.save();

    const io = req.app?.get('io');
    if (io) {
      io.to(`support:${chatId}`).emit('support_message', {
        chatId,
        messages: [chat.messages[chat.messages.length - 1]],
      });
    }

    // ── Send push notification to the user if they are logged in ─────────────
    if (chat.user) {
      try {
        const { createNotification } = require('../utils/notifications');
        const preview = message.trim().length > 80
          ? message.trim().substring(0, 80) + '…'
          : message.trim();

        await createNotification({
          userId: chat.user.toString(),
          userType: 'user',
          title: '💬 Support Team Replied',
          message: `Our support team has replied: "${preview}"`,
          type: 'admin',
          data: {
            action: 'support_reply',
            chatId: chatId.toString(),
          },
          io,
        });
      } catch (notifError) {
        console.error('⚠️ Failed to send support reply notification:', notifError.message);
        // Non-critical — don't fail the request
      }
    }

    res.status(200).json({ success: true, data: chat.messages[chat.messages.length - 1] });
  } catch (error) {
    next(error);
  }
};

// @desc  Update chat status (Admin)
// @route PUT /api/support/admin/chats/:chatId/status
// @access Private/Admin
const updateChatStatus = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const { status } = req.body;

    if (!['open', 'in_progress', 'resolved', 'closed'].includes(status)) {
      return next(new AppError('Invalid status', 400));
    }

    const chat = await SupportChat.findByIdAndUpdate(chatId, { status, adminUnread: 0 }, { new: true });
    if (!chat) return next(new AppError('Chat not found', 404));

    res.status(200).json({ success: true, data: chat });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startChat,
  sendMessage,
  getChatHistory,
  getMyChat,
  getAllChats,
  adminReply,
  updateChatStatus,
};
