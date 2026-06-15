# BG Predictor — Railway Deployment

Real-time blood sugar predictor powered by the Dexcom Share API. Runs in the cloud so you can use it on iPhone.

## Deploy to Railway (5 minutes, free)

### 1. Create a GitHub repo
- Go to github.com → New repository → name it `bg-predictor`
- Upload all files from this folder (drag and drop in the GitHub UI)

### 2. Deploy on Railway
- Go to [railway.app](https://railway.app) and sign in with GitHub
- Click **New Project → Deploy from GitHub repo**
- Select your `bg-predictor` repo
- Railway auto-detects Node.js and deploys — takes ~1 minute
- Click your deployment → **Settings → Networking → Generate Domain**
- Copy your URL (e.g. `https://bg-predictor-production.up.railway.app`)

### 3. Open on iPhone
- Paste your Railway URL into Safari on your iPhone
- Tap **Share → Add to Home Screen** to save it as an app icon
- Log in with your Dexcom credentials — readings update every 5 minutes automatically

## Free tier limits
Railway's free Hobby tier gives you $5/month of credits. This app uses almost no resources (no database, no background jobs) so it should run indefinitely for free.

## Security notes
- Credentials are only sent to Dexcom's own servers — the proxy never logs or stores passwords
- Session tokens are stored in your browser's sessionStorage and cleared when you close the tab
- For extra security, you can set a `BASIC_AUTH_PASS` environment variable in Railway to password-protect the page

## How predictions work
Linear regression over the last 60 minutes of CGM readings, projected 15 and 30 minutes forward.
⚠️ Personal tool only — not a medical device. Follow your care team's guidance.
