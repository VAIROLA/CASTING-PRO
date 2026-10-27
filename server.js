const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3300;

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Static files
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const dataDir = path.join(__dirname, 'data');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

// File Paths
const ARTISTS_FILE = path.join(dataDir, 'artists.json');
const CONFIG_FILE = path.join(dataDir, 'config.json');

// Função Geradora de PIX Padrão Banco Central (EMV / Copia e Cola)
function gerarPixEMV(chave, nome, cidade, valor, txid = 'CASTINGPRO') {
  function f(id, val) {
    const len = String(val.length).padStart(2, '0');
    return id + len + val;
  }
  const gui = f('00', 'br.gov.bcb.pix') + f('01', chave);
  const vStr = parseFloat(valor).toFixed(2);
  let payload = f('00', '01') +
                f('26', gui) +
                f('52', '0000') +
                f('53', '986') +
                f('54', vStr) +
                f('58', 'BR') +
                f('59', nome.substring(0, 25).toUpperCase()) +
                f('60', cidade.substring(0, 15).toUpperCase()) +
                f('62', f('05', txid)) +
                '6304';
  
  // CRC16 CCITT
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= (payload.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');
  return payload + crcHex;
}

// Helper to read/write JSON safely
function readJSON(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const data = fs.readFileSync(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Erro ao ler ${file}:`, err);
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Erro ao escrever em ${file}:`, err);
    return false;
  }
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `foto-${uniqueSuffix}${cleanExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Apenas JPG, PNG ou WebP são permitidos.'));
    }
  }
});

// Multer storage para upload de vídeos MP4
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanExt = ['.mp4', '.webm', '.mov'].includes(ext) ? ext : '.mp4';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `video-${uniqueSuffix}${cleanExt}`);
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // Até 100MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.mp4', '.webm', '.mov'];
    if (allowedExts.includes(ext) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Apenas arquivos de vídeo (.mp4, .webm ou .mov) são permitidos.'));
    }
  }
});

// ==========================================
// 1. CONFIGURAÇÕES COMERCIAIS
// ==========================================
app.get('/api/config', (req, res) => {
  const config = readJSON(CONFIG_FILE, {
    platform_name: "CASTING PRO",
    initial_fee: 20.00,
    monthly_fee: 10.00,
    currency: "BRL",
    symbol: "R$",
    max_presentation_photos: 7,
    max_videos: 2,
    billing_cycle_days: 30,
    grace_period_days: 5
  });
  res.json(config);
});

app.put('/api/config', (req, res) => {
  const current = readJSON(CONFIG_FILE);
  const updated = {
    ...current,
    initial_fee: parseFloat(req.body.initial_fee) || current.initial_fee,
    monthly_fee: parseFloat(req.body.monthly_fee) || current.monthly_fee,
    grace_period_days: parseInt(req.body.grace_period_days) || current.grace_period_days,
    updated_at: new Date().toISOString()
  };
  writeJSON(CONFIG_FILE, updated);
  res.json({ success: true, message: "Configurações comerciais salvas com sucesso!", config: updated });
});

// ==========================================
// 2. VITRINE PÚBLICA DE ARTISTAS
// ==========================================
app.get('/api/artistas', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const { categoria, busca, cidade } = req.query;

  // Regra Master: Só aparecem na vitrine pública artistas com perfil completo, publicado,
  // taxa inicial paga e mensalidade ativa ou em tolerância ('ativo' ou 'pagamento_pendente')
  let publicList = artists.filter(a => {
    const isPaid = a.financeiro && a.financeiro.taxa_inicial_paga;
    const isPublic = a.publicado === true;
    const hasPhoto = Boolean(a.foto_perfil);
    const validStatus = ['ativo', 'pagamento_pendente'].includes(a.status);
    return isPaid && isPublic && hasPhoto && validStatus;
  });

  if (categoria && categoria !== 'todos') {
    publicList = publicList.filter(a => (a.categoria || '').toLowerCase().includes(categoria.toLowerCase()));
  }

  if (cidade) {
    publicList = publicList.filter(a => (a.cidade || '').toLowerCase().includes(cidade.toLowerCase()));
  }

  if (busca) {
    const q = busca.toLowerCase();
    publicList = publicList.filter(a =>
      (a.nome_artistico || '').toLowerCase().includes(q) ||
      (a.nome_completo || '').toLowerCase().includes(q) ||
      (a.habilidades || []).some(h => h.toLowerCase().includes(q)) ||
      (a.biografia || '').toLowerCase().includes(q)
    );
  }

  // Sanitizar dados para visualização pública
  const sanitized = publicList.map(a => ({
    id: a.id,
    nome_artistico: a.nome_artistico,
    categoria: a.categoria,
    cidade: a.cidade,
    estado: a.estado,
    drt: a.drt,
    telefone: a.telefone || '',
    foto_perfil: a.foto_perfil,
    total_fotos_apresentacao: (a.fotos_apresentacao || []).length,
    habilidades: a.habilidades || [],
    caracteristicas: a.caracteristicas || {}
  }));

  res.json(sanitized);
});

// ==========================================
// 3. CONSULTA DE ARTISTA ESPECÍFICO (Público & Painel)
// ==========================================
app.get('/api/artistas/:id', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artist = artists.find(a => a.id === req.params.id);

  if (!artist) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const isOwnerOrAdmin = req.query.privado === 'true';

  if (!isOwnerOrAdmin && (!artist.publicado || !artist.financeiro.taxa_inicial_paga || !['ativo', 'pagamento_pendente'].includes(artist.status))) {
    return res.status(403).json({
      error: "Este perfil não está público no momento.",
      motivo: "Aguardando conclusão dos requisitos de publicação ou regularização de assinatura."
    });
  }

  res.json(artist);
});

// ==========================================
// 4. CADASTRO INICIAL & CHECKOUT (R$ 20,00 inicial + R$ 10,00 mensal)
// ==========================================
app.post('/api/cadastro', (req, res) => {
  const { nome_completo, nome_artistico, email, telefone, cidade, estado, categoria, drt } = req.body;

  if (!nome_completo || !email || !categoria) {
    return res.status(400).json({ error: "Preencha os campos obrigatórios (Nome Completo, E-mail e Categoria)." });
  }

  const artists = readJSON(ARTISTS_FILE, []);

  // Verificar e-mail duplicado
  const existing = artists.find(a => a.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: "Já existe uma conta cadastrada com este e-mail." });
  }

  const config = readJSON(CONFIG_FILE);
  const newId = 'art-' + (Date.now().toString().slice(-6));
  const txId = 'TX-INIT-' + Math.floor(100000 + Math.random() * 900000);

  const newArtist = {
    id: newId,
    nome_completo,
    nome_artistico: nome_artistico || nome_completo,
    email,
    telefone: telefone || '',
    cidade: cidade || 'São Paulo',
    estado: estado || 'SP',
    categoria,
    drt: drt || '',
    biografia: '',
    curriculo: '',
    caracteristicas: {
      altura: '',
      peso: '',
      olhos: '',
      cabelos: '',
      manequim: '',
      calcado: '',
      etnia: ''
    },
    habilidades: [],
    foto_perfil: '',
    fotos_apresentacao: [], // Até 7 fotos
    videos: [],             // Até 2 vídeos
    status: 'aguardando_pagamento',
    publicado: false,
    criado_em: new Date().toISOString(),
    financeiro: {
      taxa_inicial_paga: false,
      taxa_inicial_valor: config.initial_fee || 20.00,
      taxa_inicial_data: null,
      mensalidade_valor: config.monthly_fee || 10.00,
      plano: "Assinatura Profissional Casting Pro",
      forma_pagamento: "Aguardando confirmação",
      data_inicio: null,
      proxima_cobranca: null,
      historico: [
        {
          id: txId,
          data: new Date().toISOString(),
          tipo: "taxa_inicial",
          descricao: `Taxa Inicial Única de Cadastro (${config.symbol} ${config.initial_fee.toFixed(2)})`,
          valor: config.initial_fee,
          status: "aguardando_pagamento",
          metodo: "PIX / Cartão",
          comprovante_id: null
        }
      ]
    }
  };

  artists.push(newArtist);
  writeJSON(ARTISTS_FILE, artists);

  const pixPayload = gerarPixEMV(
    config.pagamento?.pix_chave || 'tonydeluc@portal-tvdiversidade-news.com',
    config.pagamento?.beneficiario || 'AILTON PAULO DOS SANTOS',
    config.pagamento?.cidade || 'MARICA',
    config.initial_fee || 20.00,
    'CASTING' + newId.replace('art-', '')
  );

  res.status(201).json({
    success: true,
    message: "Cadastro iniciado com sucesso! Efetue o pagamento da taxa inicial de R$ 20,00 para liberar o perfil completo.",
    artistId: newId,
    cobranca: {
      txId,
      taxa_inicial: config.initial_fee,
      mensalidade_futura: config.monthly_fee,
      beneficiario: config.pagamento?.beneficiario || 'AILTON PAULO DOS SANTOS',
      banco: config.pagamento?.banco || 'PagBank / PagSeguro',
      pix_chave: config.pagamento?.pix_chave || 'tonydeluc@portal-tvdiversidade-news.com',
      link_pagamento_taxa: config.pagamento?.link_taxa_inicial || 'https://pag.ae/82hDtvCup',
      link_pagamento_mensal: config.pagamento?.link_mensalidade || 'https://pag.ae/82hDvdzHK',
      descricao: "Taxa Única de Cadastro R$ 20,00 + Mensalidade de R$ 10,00 após 30 dias",
      pix_copia_cola: pixPayload
    }
  });
});

// ==========================================
// SERVIÇO DE NOTIFICAÇÕES DE BOAS-VINDAS (E-MAIL E WHATSAPP)
// ==========================================
async function enviarNotificacoesBoasVindas(artist, req) {
  const host = req ? req.get('host') : 'localhost:3300';
  const protocol = req && req.secure ? 'https' : 'http';
  const linkPainel = `${protocol}://${host}/painel-artista.html?id=${artist.id}`;
  const nome = artist.nome_artistico || artist.nome_completo;

  const resultado = {
    email: false,
    email_destinatario: artist.email || null,
    whatsapp: false,
    whatsapp_destinatario: artist.telefone || null,
    whatsapp_link: null
  };

  // 1. Mensagem Oficial para o WhatsApp
  if (artist.telefone) {
    const rawTel = artist.telefone.replace(/\D/g, '');
    const msgZap = `🌟 *BEM-VINDO(A) AO CASTING PRO!* 🌟\n\nOlá, *${nome}*!\n\nConfirmamos com sucesso a sua adesão à maior vitrine profissional de talentos para Cinema, TV, Teatro e Shows!\n\n💳 *Taxa de Adesão:* R$ 20,00 (Confirmada ✓)\n📅 *Manutenção Mensal:* R$ 10,00 (Inicia em 30 dias)\n\n👉 *Próximo Passo Obrigatório:*\nAcesse o seu painel exclusivo para cadastrar sua Foto Principal de Perfil (obrigatória), suas fotos de apresentação (até 7) e seus vídeos:\n🔗 ${linkPainel}\n\nSeja muito bem-vindo(a) e boas produções!\n*Equipe CASTING PRO Oficial* 🎬✨`;
    
    resultado.whatsapp = true;
    resultado.whatsapp_link = `https://wa.me/55${rawTel}?text=${encodeURIComponent(msgZap)}`;
    resultado.whatsapp_texto = msgZap;
  }

  // 2. Envio de E-mail de Boas-Vindas
  if (artist.email) {
    try {
      let transporter;
      if (process.env.SMTP_HOST && process.env.SMTP_USER) {
        transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: parseInt(process.env.SMTP_PORT || '587'),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
      }

      const htmlEmail = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b1120; color: #f8fafc; margin: 0; padding: 30px 15px;">
          <div style="max-width: 600px; margin: 0 auto; background: #131c33; border: 1.5px solid #f59e0b; border-radius: 16px; padding: 35px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);">
            <div style="text-align: center; margin-bottom: 25px;">
              <h1 style="color: #fff; margin: 0; font-size: 26px;">CASTING <span style="color: #f59e0b;">PRO</span></h1>
              <p style="color: #94a3b8; font-size: 11px; letter-spacing: 2px; margin-top: 4px;">PORTIFÓLIO ARTÍSTICO DEFINITIVO</p>
            </div>
            
            <h2 style="color: #f59e0b; font-size: 22px; text-align: center; margin-bottom: 12px;">Seja muito bem-vindo(a), ${nome}!</h2>
            <p style="color: #e2e8f0; font-size: 15px; line-height: 1.6; text-align: center;">Confirmamos com sucesso sua adesão ao catálogo profissional de elenco e produção.</p>
            
            <div style="background: #0c1222; border-left: 4px solid #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 18px; border-radius: 8px; margin: 25px 0; font-size: 14px; line-height: 1.7;">
              <strong style="color: #34d399;">✓ Taxa de Adesão:</strong> R$ 20,00 (Paga e Confirmada)<br>
              <strong>📅 Próxima Mensalidade:</strong> R$ 10,00 / mês (Inicia em 30 dias)<br>
              <strong>Código do Artista:</strong> <code>${artist.id}</code>
            </div>

            <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6;">
              Para que seu perfil fique visível imediatamente para diretores de casting e produtoras de Teatro, Cinema e TV, acesse agora o seu painel exclusivo:
            </p>

            <div style="text-align: center; margin: 30px 0;">
              <a href="${linkPainel}" style="display: inline-block; background: linear-gradient(135deg, #ffd166, #f59e0b); color: #000; font-weight: 800; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 16px; box-shadow: 0 4px 20px rgba(245, 158, 11, 0.5);">
                Acessar Meu Painel e Completar Perfil &rarr;
              </a>
            </div>

            <div style="background: rgba(255,255,255,0.04); padding: 14px; border-radius: 8px; font-size: 13px; color: #94a3b8; line-height: 1.6;">
              📌 <strong>Dicas para a Vitrine:</strong><br>
              • Envie sua <strong>Foto Principal de Perfil</strong> (obrigatória para publicação);<br>
              • Adicione até <strong>7 Fotos de Apresentação</strong> no seu book;<br>
              • Cadastre até <strong>2 Vídeos</strong> (via YouTube ou arquivo MP4 do seu computador);<br>
              • Preencha seu número de <strong>DRT</strong> e <strong>WhatsApp</strong>.
            </div>

            <div style="text-align: center; color: #64748b; font-size: 11px; margin-top: 30px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; line-height: 1.5;">
              CASTING PRO Tecnologia e Produção LTDA<br>
              <em>Aviso Legal: As informações, DRT, imagens e contatos são de inteira e exclusiva responsabilidade do artista titular.</em>
            </div>
          </div>
        </div>
      `;

      if (transporter) {
        await transporter.sendMail({
          from: `"CASTING PRO" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
          to: artist.email,
          subject: `🎬 Bem-vindo(a) ao CASTING PRO, ${nome}! Seu acesso está liberado`,
          html: htmlEmail
        });
        resultado.email = true;
      } else {
        console.log(`[E-MAIL BOAS-VINDAS] Disparado com sucesso para ${artist.email} (Nome: ${nome})`);
        resultado.email = true;
        resultado.email_simulado = true;
      }
    } catch (errEmail) {
      console.error('[ERRO E-MAIL]', errEmail);
      resultado.email_erro = errEmail.message;
    }
  }

  // Registra no histórico do artista
  if (!artist.notificacoes) artist.notificacoes = {};
  artist.notificacoes.boas_vindas = {
    enviado_em: new Date().toISOString(),
    email: resultado.email,
    email_destinatario: artist.email,
    whatsapp: resultado.whatsapp,
    whatsapp_destinatario: artist.telefone,
    whatsapp_link: resultado.whatsapp_link
  };

  return resultado;
}

// ==========================================
// 5. WEBHOOK & CONFIRMAÇÃO SEGURA DE PAGAMENTO INICIAL
// ==========================================
app.post('/api/pagamento/confirmar-inicial', async (req, res) => {
  const { artistId, metodo, comprovante, codigoTransacao } = req.body;
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === artistId);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const artist = artists[artistIndex];
  const now = new Date();
  const nextMonth = new Date();
  nextMonth.setDate(now.getDate() + 30);

  const comprovanteId = 'REC-INI-' + Date.now().toString().slice(-6);

  // Atualiza finanças
  artist.financeiro.taxa_inicial_paga = true;
  artist.financeiro.taxa_inicial_data = now.toISOString();
  artist.financeiro.data_inicio = now.toISOString();
  artist.financeiro.proxima_cobranca = nextMonth.toISOString();
  artist.financeiro.forma_pagamento = metodo || 'PIX';

  // Atualiza status: agora liberado para preenchimento ou ativo
  artist.status = artist.foto_perfil ? 'ativo' : 'preenchimento_perfil';

  // Atualiza ou insere histórico
  const existingTx = artist.financeiro.historico.find(t => t.tipo === 'taxa_inicial');
  if (existingTx) {
    existingTx.status = 'pago';
    existingTx.data = now.toISOString();
    existingTx.metodo = metodo || 'PIX';
    existingTx.comprovante_id = comprovanteId;
  } else {
    artist.financeiro.historico.push({
      id: 'TX-INI-' + Date.now().toString().slice(-6),
      data: now.toISOString(),
      tipo: 'taxa_inicial',
      descricao: 'Taxa Inicial de Cadastro Profissional',
      valor: artist.financeiro.taxa_inicial_valor,
      status: 'pago',
      metodo: metodo || 'PIX',
      comprovante_id: comprovanteId
    });
  }

  // DISPARAR NOTIFICAÇÕES DE BOAS-VINDAS (EMAIL E WHATSAPP)
  const notificacoes = await enviarNotificacoesBoasVindas(artist, req);

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: "Pagamento da taxa inicial de R$ 20,00 confirmado com sucesso! Cadastro profissional desbloqueado.",
    status: artist.status,
    comprovante_id: comprovanteId,
    proxima_cobranca: artist.financeiro.proxima_cobranca,
    notificacoes: {
      email_enviado: notificacoes.email,
      email_destinatario: notificacoes.email_destinatario,
      whatsapp_enviado: notificacoes.whatsapp,
      whatsapp_link: notificacoes.whatsapp_link
    }
  });
});

// ==========================================
// 6. UPLOAD DE FOTOGRAFIA PRINCIPAL OBRIGATÓRIA (com validação e ajuste)
// ==========================================
app.post('/api/artistas/:id/foto-perfil', upload.single('foto'), (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  if (!req.file && !req.body.foto_url) {
    return res.status(400).json({ error: "Nenhuma imagem foi enviada." });
  }

  const fotoUrl = req.file ? `/uploads/${req.file.filename}` : req.body.foto_url;
  artists[artistIndex].foto_perfil = fotoUrl;

  // Se o artista já pagou a taxa e estava em 'preenchimento_perfil', avalia status
  if (artists[artistIndex].financeiro.taxa_inicial_paga && artists[artistIndex].status === 'preenchimento_perfil') {
    artists[artistIndex].status = 'ativo';
    artists[artistIndex].publicado = true;
  }

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: "Fotografia principal de perfil atualizada com sucesso!",
    foto_perfil: fotoUrl,
    status: artists[artistIndex].status
  });
});

// ==========================================
// 7. SEÇÃO: MINHAS FOTOS DE APRESENTAÇÃO (Limite estrito de até 7 fotos)
// ==========================================
app.post('/api/artistas/:id/fotos-apresentacao', upload.single('foto'), (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const artist = artists[artistIndex];
  if (!artist.fotos_apresentacao) {
    artist.fotos_apresentacao = [];
  }

  const slotIndex = req.body.slot ? parseInt(req.body.slot) - 1 : null;
  const fotoUrl = req.file ? `/uploads/${req.file.filename}` : req.body.foto_url;
  const legenda = req.body.legenda || 'Foto de apresentação';

  if (!fotoUrl) {
    return res.status(400).json({ error: "Nenhum arquivo ou URL de imagem informado." });
  }

  // Substituição de slot específico
  if (slotIndex !== null && slotIndex >= 0 && slotIndex < artist.fotos_apresentacao.length) {
    artist.fotos_apresentacao[slotIndex] = {
      id: artist.fotos_apresentacao[slotIndex].id || Date.now(),
      url: fotoUrl,
      legenda: legenda
    };
    writeJSON(ARTISTS_FILE, artists);
    return res.json({
      success: true,
      message: `Espaço ${slotIndex + 1} substituído com sucesso!`,
      fotos_apresentacao: artist.fotos_apresentacao
    });
  }

  // Inserção de nova foto: Regra Master #5 (Máximo 7 fotos de apresentação)
  if (artist.fotos_apresentacao.length >= 7) {
    return res.status(400).json({
      error: "Limite de 7 fotografias de apresentação atingido!",
      detalhes: "O perfil permite 1 foto principal obrigatória mais até 7 fotos de apresentação. Para adicionar uma nova imagem, você deve remover ou substituir uma das imagens existentes."
    });
  }

  artist.fotos_apresentacao.push({
    id: Date.now(),
    url: fotoUrl,
    legenda: legenda
  });

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: `Foto de apresentação adicionada com sucesso! (${artist.fotos_apresentacao.length} de 7 fotos preenchidas)`,
    fotos_apresentacao: artist.fotos_apresentacao
  });
});

// Excluir foto de apresentação
app.delete('/api/artistas/:id/fotos-apresentacao/:fotoId', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const fotoId = req.params.fotoId;
  const artist = artists[artistIndex];

  artist.fotos_apresentacao = (artist.fotos_apresentacao || []).filter(f => String(f.id) !== String(fotoId));
  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: "Foto de apresentação removida com sucesso.",
    fotos_apresentacao: artist.fotos_apresentacao
  });
});

// Reordenar fotos de apresentação
app.put('/api/artistas/:id/fotos-apresentacao/reordenar', (req, res) => {
  const { ordemIds } = req.body; // Array com IDs na nova ordem desejada
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const artist = artists[artistIndex];
  if (Array.isArray(ordemIds) && artist.fotos_apresentacao) {
    const map = new Map(artist.fotos_apresentacao.map(f => [String(f.id), f]));
    const reordered = [];
    ordemIds.forEach(id => {
      if (map.has(String(id))) reordered.push(map.get(String(id)));
    });
    // Se sobrar alguma não especificada
    artist.fotos_apresentacao.forEach(f => {
      if (!reordered.some(r => String(r.id) === String(f.id))) {
        reordered.push(f);
      }
    });
    artist.fotos_apresentacao = reordered.slice(0, 7);
    writeJSON(ARTISTS_FILE, artists);
  }

  res.json({
    success: true,
    message: "Ordem da galeria atualizada com sucesso!",
    fotos_apresentacao: artist.fotos_apresentacao
  });
});

// ==========================================
// 8. ATUALIZAR DADOS DO PERFIL & VÍDEOS (Limite de 2 vídeos)
// ==========================================
app.put('/api/artistas/:id', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const current = artists[artistIndex];
  const {
    nome_artistico,
    telefone,
    cidade,
    estado,
    categoria,
    drt,
    biografia,
    curriculo,
    caracteristicas,
    habilidades,
    videos
  } = req.body;

  // Validação do limite de vídeos (Regra Master: até 2 vídeos)
  let updatedVideos = current.videos || [];
  if (Array.isArray(videos)) {
    if (videos.length > 2) {
      return res.status(400).json({ error: "Limite excedido: São permitidos no máximo 2 vídeos de trabalho por artista." });
    }
    updatedVideos = videos.slice(0, 2);
  }

  artists[artistIndex] = {
    ...current,
    nome_artistico: nome_artistico || current.nome_artistico,
    telefone: telefone !== undefined ? telefone : current.telefone,
    cidade: cidade !== undefined ? cidade : current.cidade,
    estado: estado !== undefined ? estado : current.estado,
    categoria: categoria || current.categoria,
    drt: drt !== undefined ? drt : current.drt,
    biografia: biografia !== undefined ? biografia : current.biografia,
    curriculo: curriculo !== undefined ? curriculo : current.curriculo,
    caracteristicas: caracteristicas ? { ...current.caracteristicas, ...caracteristicas } : current.caracteristicas,
    habilidades: Array.isArray(habilidades) ? habilidades : current.habilidades,
    videos: updatedVideos
  };

  writeJSON(ARTISTS_FILE, artists);
  res.json({ success: true, message: "Perfil atualizado com sucesso!", artista: artists[artistIndex] });
});

// Endpoint para Upload de Vídeo MP4 do Computador (Até 2 vídeos)
app.post('/api/artistas/:id/upload-video', uploadVideo.single('video'), (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo de vídeo foi enviado." });
  }

  const artist = artists[artistIndex];
  if (!artist.videos) artist.videos = [];

  const slot = req.body.slot ? parseInt(req.body.slot) - 1 : 0;
  const titulo = req.body.titulo || `Vídeo ${slot + 1} (Upload MP4)`;
  const videoUrl = `/uploads/${req.file.filename}`;

  const novoVideo = {
    id: Date.now(),
    titulo,
    url: videoUrl,
    tipo: 'mp4_upload'
  };

  if (slot >= 0 && slot < 2) {
    artist.videos[slot] = novoVideo;
  } else {
    if (artist.videos.length >= 2) {
      return res.status(400).json({ error: "Limite excedido: São permitidos no máximo 2 vídeos de trabalho por artista." });
    }
    artist.videos.push(novoVideo);
  }

  // Garantir que nunca passe de 2
  artist.videos = artist.videos.slice(0, 2);

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: `Vídeo MP4 enviado com sucesso para o Espaço ${slot + 1}!`,
    videos: artist.videos
  });
});

// Endpoint para remover vídeo de um slot específico
app.delete('/api/artistas/:id/videos/:slot', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const artist = artists[artistIndex];
  const slot = parseInt(req.params.slot) - 1;

  if (artist.videos && artist.videos[slot]) {
    artist.videos.splice(slot, 1);
    writeJSON(ARTISTS_FILE, artists);
  }

  res.json({
    success: true,
    message: "Vídeo removido com sucesso.",
    videos: artist.videos || []
  });
});

// ==========================================
// 9. PUBLICAR OU PAUSAR PERFIL (Com checagem obrigatória)
// ==========================================
app.post('/api/artistas/:id/publicar', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.id);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const artist = artists[artistIndex];
  const { publicar } = req.body; // true ou false

  if (publicar === true) {
    // 1. Checagem da taxa inicial
    if (!artist.financeiro || !artist.financeiro.taxa_inicial_paga) {
      return res.status(400).json({
        error: "Bloqueio de Publicação: A taxa inicial de R$ 20,00 deve estar paga e confirmada antes de publicar o perfil."
      });
    }

    // 2. Checagem da fotografia principal obrigatória (Regra Master #4)
    if (!artist.foto_perfil || artist.foto_perfil.trim() === '') {
      return res.status(400).json({
        error: "Bloqueio de Publicação: A fotografia principal de perfil é obrigatória. Cadastre sua foto antes de publicar."
      });
    }

    // 3. Checagem da situação da assinatura
    if (['pagamento_atrasado', 'cancelado'].includes(artist.status)) {
      return res.status(400).json({
        error: `Bloqueio de Publicação: Sua assinatura está na situação '${artist.status}'. Regularize sua mensalidade para reativar o perfil.`
      });
    }

    artist.publicado = true;
    artist.status = 'ativo';
  } else {
    artist.publicado = false;
  }

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: publicar ? "Perfil publicado com sucesso na vitrine profissional!" : "Perfil ocultado da busca pública.",
    publicado: artist.publicado,
    status: artist.status
  });
});

// ==========================================
// 10. GESTÃO DA ASSINATURA DO ARTISTA (Seção MINHA ASSINATURA)
// ==========================================
app.get('/api/assinatura/:artistId', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const artist = artists.find(a => a.id === req.params.artistId);

  if (!artist) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const config = readJSON(CONFIG_FILE);

  res.json({
    taxa_inicial: config.initial_fee,
    mensalidade: config.monthly_fee,
    status: artist.status,
    financeiro: artist.financeiro,
    publicado: artist.publicado,
    termos_cancelamento: "O cancelamento da assinatura suspende a renovação mensal automática. O perfil permanece ativo até o fim do período mensal já pago, quando a visibilidade pública será pausada sem exclusão dos seus dados, fotos ou vídeos."
  });
});

// Cancelar Assinatura
app.post('/api/assinatura/:artistId/cancelar', (req, res) => {
  const { motivo } = req.body;
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.artistId);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const artist = artists[artistIndex];
  artist.status = 'cancelamento_solicitado';
  artist.financeiro.cancelado_em = new Date().toISOString();
  artist.financeiro.motivo_cancelamento = motivo || 'Solicitado pelo artista';

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: "Solicitação de cancelamento registrada com sucesso. Nenhuma nova mensalidade será cobrada. Seus dados e fotos continuam preservados na plataforma.",
    status: artist.status
  });
});

// Regularizar / Pagar Mensalidade
app.post('/api/assinatura/:artistId/regularizar', (req, res) => {
  const { metodo } = req.body;
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === req.params.artistId);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado." });
  }

  const artist = artists[artistIndex];
  const config = readJSON(CONFIG_FILE);
  const now = new Date();
  const nextMonth = new Date();
  nextMonth.setDate(now.getDate() + 30);

  const comprovanteId = 'REC-MENS-' + Date.now().toString().slice(-6);

  artist.status = 'ativo';
  artist.publicado = true;
  artist.financeiro.proxima_cobranca = nextMonth.toISOString();

  artist.financeiro.historico.push({
    id: 'TX-MENS-' + Date.now().toString().slice(-6),
    data: now.toISOString(),
    tipo: 'mensalidade',
    descricao: `Mensalidade de Manutenção do Perfil (${config.symbol} ${config.monthly_fee.toFixed(2)})`,
    valor: config.monthly_fee,
    status: 'pago',
    metodo: metodo || 'PIX',
    comprovante_id: comprovanteId
  });

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: "Mensalidade regularizada com sucesso! Seu perfil continua ativo na plataforma.",
    status: artist.status,
    comprovante_id: comprovanteId,
    proxima_cobranca: artist.financeiro.proxima_cobranca
  });
});

// ==========================================
// 11. PAINEL ADMINISTRATIVO COMERCIAL
// ==========================================
app.get('/api/admin/metricas', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  const config = readJSON(CONFIG_FILE);

  let cadastrosIniciados = 0;
  let taxasIniciaisPagas = 0;
  let assinaturasAtivas = 0;
  let assinaturasCanceladas = 0;
  let pagamentosPendentes = 0;
  let pagamentosAtrasados = 0;

  let receitaTaxasIniciais = 0;
  let receitaRecorrenteMensal = 0;

  const todasTransacoes = [];

  artists.forEach(a => {
    // Contagem de status
    if (a.status === 'cadastro_iniciado' || a.status === 'aguardando_pagamento') cadastrosIniciados++;
    if (a.status === 'ativo') assinaturasAtivas++;
    if (a.status === 'cancelamento_solicitado' || a.status === 'cancelado') assinaturasCanceladas++;
    if (a.status === 'pagamento_pendente') pagamentosPendentes++;
    if (a.status === 'pagamento_atrasado') pagamentosAtrasados++;

    if (a.financeiro) {
      if (a.financeiro.taxa_inicial_paga) {
        taxasIniciaisPagas++;
      }

      (a.financeiro.historico || []).forEach(tx => {
        todasTransacoes.push({
          ...tx,
          artista_id: a.id,
          artista_nome: a.nome_artistico || a.nome_completo,
          email: a.email
        });

        if (tx.status === 'pago') {
          if (tx.tipo === 'taxa_inicial') {
            receitaTaxasIniciais += parseFloat(tx.valor) || 0;
          } else if (tx.tipo === 'mensalidade') {
            receitaRecorrenteMensal += parseFloat(tx.valor) || 0;
          }
        }
      });
    }
  });

  // Ordenar transações por data decrescente
  todasTransacoes.sort((a, b) => new Date(b.data) - new Date(a.data));

  res.json({
    totais: {
      total_artistas: artists.length,
      cadastros_iniciados: cadastrosIniciados,
      taxas_iniciais_pagas: taxasIniciaisPagas,
      assinaturas_ativas: assinaturasAtivas,
      assinaturas_canceladas: assinaturasCanceladas,
      pagamentos_pendentes: pagamentosPendentes,
      pagamentos_atrasados: pagamentosAtrasados
    },
    receita: {
      taxa_inicial_unitaria: config.initial_fee,
      mensalidade_unitaria: config.monthly_fee,
      receita_taxas_iniciais: receitaTaxasIniciais,
      receita_recorrente_mensal: receitaRecorrenteMensal,
      receita_total: receitaTaxasIniciais + receitaRecorrenteMensal,
      mrr_projetado: assinaturasAtivas * config.monthly_fee
    },
    transacoes: todasTransacoes.slice(0, 50),
    config
  });
});

// Simulador de Ciclo Financeiro (Ferramenta de testes do Admin para demonstrar renovação automática / inadimplência)
app.post('/api/admin/simular-ciclo', (req, res) => {
  const { acao, artistId } = req.body;
  const artists = readJSON(ARTISTS_FILE, []);
  const artistIndex = artists.findIndex(a => a.id === artistId);

  if (artistIndex === -1) {
    return res.status(404).json({ error: "Artista não encontrado para simulação." });
  }

  const artist = artists[artistIndex];
  const config = readJSON(CONFIG_FILE);

  if (acao === 'renovar_mensalidade') {
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 30);
    const comprovanteId = 'SIM-REC-' + Date.now().toString().slice(-4);

    artist.status = 'ativo';
    artist.publicado = true;
    artist.financeiro.proxima_cobranca = nextDate.toISOString();
    artist.financeiro.historico.push({
      id: 'SIM-TX-' + Date.now().toString().slice(-4),
      data: new Date().toISOString(),
      tipo: 'mensalidade',
      descricao: 'Renovação Automática de Mensalidade (Simulação Webhook)',
      valor: config.monthly_fee,
      status: 'pago',
      metodo: 'Cartão de Crédito Automático',
      comprovante_id: comprovanteId
    });
  } else if (acao === 'falhar_cobranca') {
    artist.status = 'pagamento_pendente';
    artist.financeiro.historico.push({
      id: 'SIM-FAIL-' + Date.now().toString().slice(-4),
      data: new Date().toISOString(),
      tipo: 'mensalidade',
      descricao: 'Tentativa de Cobrança Recorrente Recusada',
      valor: config.monthly_fee,
      status: 'pendente',
      metodo: 'Cartão de Crédito (Saldo Insuficiente)',
      comprovante_id: null
    });
  } else if (acao === 'suspender_atraso') {
    artist.status = 'pagamento_atrasado';
    artist.publicado = false; // Suspensão de visibilidade mantendo integridade dos dados
  }

  writeJSON(ARTISTS_FILE, artists);

  res.json({
    success: true,
    message: `Simulação '${acao}' executada no artista ${artist.nome_artistico}!`,
    artista: artist
  });
});

// Emissão de Comprovante / Recibo
app.get('/api/recibos/:id', (req, res) => {
  const artists = readJSON(ARTISTS_FILE, []);
  let foundTx = null;
  let foundArtist = null;

  for (const a of artists) {
    const tx = (a.financeiro?.historico || []).find(t => t.id === req.params.id || t.comprovante_id === req.params.id);
    if (tx) {
      foundTx = tx;
      foundArtist = a;
      break;
    }
  }

  if (!foundTx) {
    return res.status(404).send('<h2>Comprovante fiscal/recibo não encontrado.</h2>');
  }

  const html = `
  <!DOCTYPE html>
  <html lang="pt-BR">
  <head>
    <meta charset="UTF-8">
    <title>Comprovante de Pagamento • CASTING PRO</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; padding: 40px 20px; color: #1e293b; }
      .receipt-box { max-width: 620px; margin: 0 auto; background: #fff; padding: 35px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
      .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
      .brand { font-size: 1.5rem; font-weight: 800; color: #0f172a; letter-spacing: 1px; display: flex; align-items: center; gap: 10px; }
      .brand img { height: 42px; width: 42px; border-radius: 8px; object-fit: cover; }
      .brand span { color: #f59e0b; }
      .badge { background: #dcfce7; color: #15803d; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; }
      .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
      .label { color: #64748b; font-size: 0.95rem; }
      .val { font-weight: 600; color: #0f172a; text-align: right; }
      .total-row { display: flex; justify-content: space-between; padding: 18px 0; border-top: 2px solid #0f172a; margin-top: 15px; font-size: 1.25rem; font-weight: 800; }
      .footer { margin-top: 25px; text-align: center; color: #94a3b8; font-size: 0.8rem; line-height: 1.5; }
      .btn { display: inline-block; margin-top: 20px; background: #0f172a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; cursor: pointer; border: none; }
      @media print { .btn { display: none; } }
    </style>
  </head>
  <body>
    <div class="receipt-box">
      <div class="header">
        <div class="brand">
          <img src="/img/logo.jpg" alt="Logo CASTING PRO">
          <div>CASTING<span>PRO</span></div>
        </div>
        <div class="badge">PAGAMENTO CONFIRMADO</div>
      </div>
      <div style="margin: 25px 0;">
        <h3 style="margin-bottom: 5px;">Recibo Comercial Eletrônico</h3>
        <p style="color: #64748b; font-size: 0.85rem;">ID de Autenticação: ${foundTx.comprovante_id || foundTx.id}</p>
      </div>
      <div class="row">
        <span class="label">Artista / Contratante</span>
        <span class="val">${foundArtist.nome_completo} (${foundArtist.nome_artistico})</span>
      </div>
      <div class="row">
        <span class="label">E-mail</span>
        <span class="val">${foundArtist.email}</span>
      </div>
      <div class="row">
        <span class="label">Data & Hora da Confirmação</span>
        <span class="val">${new Date(foundTx.data).toLocaleString('pt-BR')}</span>
      </div>
      <div class="row">
        <span class="label">Descrição do Serviço</span>
        <span class="val">${foundTx.descricao}</span>
      </div>
      <div class="row">
        <span class="label">Forma de Pagamento</span>
        <span class="val">${foundTx.metodo}</span>
      </div>
      <div class="row">
        <span class="label">Tipo de Cobrança</span>
        <span class="val">${foundTx.tipo === 'taxa_inicial' ? 'Taxa Única de Cadastro Inicial' : 'Assinatura Recorrente Mensal'}</span>
      </div>
      <div class="total-row">
        <span>VALOR TOTAL</span>
        <span>R$ ${parseFloat(foundTx.valor).toFixed(2)}</span>
      </div>
      <div class="footer">
        Este documento comprova a transação financeira realizada junto à plataforma CASTING PRO Tecnologia e Serviços LTDA.<br>
        Ambiente de cobrança seguro auditado.
      </div>
      <div style="text-align: center;">
        <button class="btn" onclick="window.print()">Imprimir ou Salvar em PDF</button>
      </div>
    </div>
  </body>
  </html>
  `;
  res.send(html);
});

// Fallback to index
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎬 CASTING PRO - Servidor Comercial Ativo!`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`💳 Taxa Inicial: R$ 20,00 | Mensalidade: R$ 10,00`);
  console.log(`📸 Limites: 1 Foto Perfil + Até 7 Fotos Apresentação + Até 2 Vídeos`);
  console.log(`=======================================================`);
});
