import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleTelegramUpdate } from './src/lib/telegram';
import { isUpdateAlreadyProcessed } from './src/lib/serverFirestore';
import { parseTransactionWithGemini, isRateLimitError } from './src/lib/gemini';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'CatatKas API',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    hasTelegramToken: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_telegram_bot_token'),
  });
});

// Gemini Parse API endpoint (Proxy for frontend natural language simulator & manual entry)
app.post('/api/gemini/parse', async (req, res) => {
  try {
    const { text, date, forceAi } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Teks input diperlukan' });
    }

    const result = await parseTransactionWithGemini(text, date, { forceAi: Boolean(forceAi) });
    return res.json(result);
  } catch (error: any) {
    if (isRateLimitError(error)) {
      console.warn('[API /gemini/parse] Gemini rate limit reached (429)');
      return res.status(429).json({
        error: '⚠️ AI sedang mencapai batas penggunaan. Coba lagi setelah kuota tersedia.',
        isRateLimit: true,
      });
    }
    console.error('Error parsing text with Gemini:', error);
    return res.status(500).json({
      error: 'Gagal menganalisis teks transaksi',
      details: error.message,
    });
  }
});

// Telegram Webhook endpoint
app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];

    // Validate secret if configured
    if (secret && secret !== 'your_telegram_webhook_secret' && incomingSecret !== secret) {
      console.warn('Unauthorized Telegram webhook attempt');
      return res.status(401).json({ error: 'Unauthorized webhook' });
    }

    const update = req.body;
    if (!update || !update.update_id) {
      return res.status(400).json({ error: 'Invalid Telegram update' });
    }

    // Deduplication check: Telegram retries unacknowledged updates
    const isDuplicate = await isUpdateAlreadyProcessed(update.update_id);
    if (isDuplicate) {
      console.log(`Duplicate Telegram update ignored: ${update.update_id}`);
      return res.status(200).json({ ok: true, note: 'Duplicate update ignored' });
    }

    // Process update asynchronously to quickly respond HTTP 200 to Telegram
    handleTelegramUpdate(update).catch((err) => {
      console.error('Background Telegram processing error:', err);
    });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Telegram Webhook Status / Test endpoint
app.get('/api/telegram/status', (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const isConfigured = Boolean(token && token !== 'your_telegram_bot_token');
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'Bundahara23_bot';
  const appUrl = process.env.APP_URL || '';
  const webhookUrl = appUrl ? `${appUrl.replace(/\/$/, '')}/api/telegram/webhook` : '';

  res.json({
    configured: isConfigured,
    botUsername,
    webhookUrl,
    instructions: isConfigured
      ? `Webhook endpoint aktif di ${webhookUrl}`
      : 'Atur TELEGRAM_BOT_TOKEN di environment variables.',
  });
});

// Telegram Long-Polling for development and environments where inbound webhooks are firewalled
async function startTelegramPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token') {
    console.log('[Telegram Poller] Token not configured. Poller inactive.');
    return;
  }

  console.log('[Telegram Poller] Initializing polling for @' + (process.env.TELEGRAM_BOT_USERNAME || 'bot'));

  // Delete webhook so Telegram delivers updates to getUpdates
  try {
    const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    const delData = await delRes.json();
    console.log('[Telegram Poller] Webhook delete response:', delData);
  } catch (err) {
    console.warn('[Telegram Poller] Notice while deleting webhook:', err);
  }

  let offset = 0;
  let isRunning = true;

  const pollLoop = async () => {
    while (isRunning) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=10`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              offset = Math.max(offset, update.update_id + 1);
              const isDup = await isUpdateAlreadyProcessed(update.update_id);
              if (!isDup) {
                console.log(`[Telegram Poller] Processing update ${update.update_id}`);
                await handleTelegramUpdate(update).catch((e) => {
                  console.error('[Telegram Poller] Error handling update:', e);
                });
              }
            }
          }
        } else {
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (pollErr) {
        // Network or transient error, retry after 3 seconds
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };

  pollLoop().catch((err) => {
    console.error('[Telegram Poller] Fatal loop error:', err);
  });
}

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CatatKas Server running on http://0.0.0.0:${PORT}`);
    // Start Telegram polling automatically
    startTelegramPolling();
  });
}

startServer();
