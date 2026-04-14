const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const multer = require('multer');
const FormData = require('form-data');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración
const TARGET_DOMAIN = 'https://dimex.wflows.run';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Crear directorio de uploads si no existe
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos (logo, css, etc) - DEBE ir antes de las rutas dinámicas
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de multer para archivos
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// =====================================================
// RUTA PRINCIPAL - Panel de control
// =====================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =====================================================
// RUTAS DE API - Capturar TODOS los métodos antes de las rutas dinámicas
// =====================================================
app.all('/api/*', async (req, res) => {
  try {
    const targetUrl = `${TARGET_DOMAIN}${req.originalUrl}`;
    console.log(`[API] ${req.method} ${req.originalUrl} -> ${targetUrl}`);
    
    // Si es petición workflows, procesar el body
    let bodyData = req.body;
    const isWorkflows = req.body && req.body.platform === 'workflows' && req.body.body;
    
    if (isWorkflows) {
      console.log('[API] Detectada petición workflows, decodificando body...');
      // Decodificar el body que viene en base64
      if (typeof req.body.body === 'string') {
        try {
          const decoded = Buffer.from(req.body.body, 'base64').toString('utf8');
          bodyData = JSON.parse(decoded);
          console.log('[API] Body decodificado:', JSON.stringify(bodyData).substring(0, 200));
        } catch (e) {
          console.log('[API] Error decodificando base64:', e.message);
          bodyData = req.body.body;
        }
      } else {
        bodyData = req.body.body;
      }
    }
    
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: bodyData,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Content-Type': isWorkflows ? 'application/json' : (req.headers['content-type'] || 'application/json'),
        'Accept': req.headers['accept'] || '*/*',
        'Cookie': req.headers['cookie'] || '',
        'Origin': TARGET_DOMAIN,
        'Referer': req.headers.referer || TARGET_DOMAIN,
        'X-Rem-Workflow': req.headers['x-rem-workflow'] || (req.body?.headers?.['X-Rem-Workflow'] || ''),
      },
      timeout: 30000,
      validateStatus: () => true,
      maxRedirects: 0,
    });
    
    console.log(`[API] Respuesta: ${response.status}`);
    
    // Propagar headers importantes
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers['set-cookie']) {
      res.setHeader('Set-Cookie', response.headers['set-cookie']);
    }
    
    res.status(response.status).send(response.data);
  } catch (error) {
    console.error('[API] Error:', error.message);
    res.status(500).send({ error: 'API proxy error', details: error.message });
  }
});

// =====================================================
// PROXY DE RECURSOS ESTÁTICOS (CSS, JS, imágenes)
// =====================================================
app.get('/proxy-resource', async (req, res) => {
  try {
    const resourceUrl = req.query.url;
    if (!resourceUrl) {
      return res.status(400).send('URL no proporcionada');
    }

    console.log(`[RESOURCE] Proxy: ${resourceUrl.substring(0, 80)}...`);

    const response = await axios({
      method: 'GET',
      url: resourceUrl,
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        'Referer': TARGET_DOMAIN,
      }
    });

    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data, 'binary'));

  } catch (error) {
    console.error('[ERROR] Resource proxy:', error.message);
    res.status(404).send('Recurso no encontrado');
  }
});

// =====================================================
// PROXY PRINCIPAL - Captura cualquier folio
// =====================================================
app.get('/:folio(*)', async (req, res) => {
  try {
    let folio = req.params.folio;
    let targetDomain = TARGET_DOMAIN;
    
    // Detectar si el folio es una URL completa
    if (folio.startsWith('http://') || folio.startsWith('https://')) {
      try {
        const parsedUrl = new URL(folio);
        targetDomain = `${parsedUrl.protocol}//${parsedUrl.host}`;
        folio = parsedUrl.pathname.replace(/^\//, '');
        // Preservar query string si existe
        if (parsedUrl.search) {
          folio += parsedUrl.search;
        }
        console.log(`[PROXY] URL completa detectada. Dominio: ${targetDomain}, Folio: ${folio}`);
      } catch (e) {
        console.log('[PROXY] Error al parsear URL, usando como folio literal');
      }
    }
    
    const targetUrl = `${targetDomain}/${folio}`;
    
    console.log(`[PROXY] Solicitando: ${targetUrl}`);
    console.log(`[PROXY] Cookies del cliente:`, req.headers.cookie || 'ninguna');

    // Headers para evadir CORS y parecer navegador real
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.8,en-US;q=0.5,en;q=0.3',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
    };

    // Copiar cookies si existen
    if (req.headers.cookie) {
      headers['Cookie'] = req.headers.cookie;
    }

    // Solicitud al servidor original
    const response = await axios({
      method: 'GET',
      url: targetUrl,
      headers: headers,
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });

    // Obtener cookies de sesión para pasarlas al cliente
    if (response.headers['set-cookie']) {
      console.log(`[PROXY] Cookies establecidas por servidor:`, response.headers['set-cookie']);
      res.setHeader('Set-Cookie', response.headers['set-cookie']);
    } else {
      console.log(`[PROXY] El servidor no estableció cookies`);
    }

    // Procesar HTML solo si es contenido HTML
    const contentType = response.headers['content-type'] || '';
    
    if (contentType.includes('text/html')) {
      const modifiedHtml = modifyHtml(response.data, folio);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(modifiedHtml);
    }

    // Para otros contenidos, reenviar tal cual
    res.setHeader('Content-Type', contentType);
    return res.send(response.data);

  } catch (error) {
    console.error('[ERROR] Proxy:', error.message);
    const targetUrl = `${TARGET_DOMAIN}/${folio}`;
    res.status(500).send(`
      <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
            .container { background: white; max-width: 600px; margin: 50px auto; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-top: 4px solid #006633; }
            h2 { color: #006633; margin-bottom: 20px; }
            .error-box { background: #ffebee; border-left: 4px solid #c62828; padding: 15px; margin: 20px 0; text-align: left; font-family: monospace; font-size: 0.9rem; color: #333; }
            .url-box { background: #e8f5e9; padding: 10px; margin: 15px 0; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 0.85rem; color: #006633; }
            a { display: inline-block; margin-top: 20px; padding: 12px 30px; background: #006633; color: white; text-decoration: none; border-radius: 4px; }
            a:hover { background: #009944; }
            .tip { color: #666; font-size: 0.9rem; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>HG Consultores - Error de Conexión</h2>
            <p>No se pudo cargar el expediente desde el servidor remoto.</p>
            <div class="url-box">${targetUrl}</div>
            <div class="error-box">Error: ${error.message}</div>
            <p class="tip">Verifica que el folio/token sea correcto o intenta nuevamente.</p>
            <a href="/">Volver al inicio</a>
          </div>
        </body>
      </html>
    `);
  }
});

// =====================================================
// MANEJO DE POST/FORMULARIOS (incluyendo archivos)
// =====================================================
app.post('/:folio(*)', upload.any(), async (req, res) => {
  let folio = req.params.folio;
  let targetDomain = TARGET_DOMAIN;
  let targetUrl = '';
  
  // Detectar si el folio es una URL completa
  if (folio.startsWith('http://') || folio.startsWith('https://')) {
    try {
      const decodedFolio = decodeURIComponent(folio);
      const parsedUrl = new URL(decodedFolio);
      targetDomain = `${parsedUrl.protocol}//${parsedUrl.host}`;
      folio = parsedUrl.pathname.replace(/^\//, '');
      if (parsedUrl.search) {
        folio += parsedUrl.search;
      }
    } catch (e) {
      // Si falla el decode, usar como está
    }
  }
  
  targetUrl = `${targetDomain}/${folio}`;

  try {
    // Detectar si es petición de workflows API (path empieza con /api/)
    const isApiRequest = req.body && req.body.path && req.body.path.startsWith('/api/');
    const isWorkflowsApi = req.body && req.body.platform === 'workflows' && req.body.token;
    
    // Construir URL: si es API, usar el path del body
    let apiUrl = targetUrl;
    if (isApiRequest && req.body.path) {
      apiUrl = `${targetDomain}${req.body.path}`;
    }
    
    console.log(`[UPLOAD] isApiRequest:`, isApiRequest);
    console.log(`[UPLOAD] Reenviando a: ${apiUrl}`);
    console.log(`[UPLOAD] Cookies recibidas:`, req.headers.cookie || 'ninguna');
    console.log(`[UPLOAD] Archivos:`, req.files?.map(f => f.fieldname));

    let requestConfig;

    if (isWorkflowsApi) {
      // Petición de workflows - enviar como JSON
      const headers = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-MX,es;q=0.9',
        'Content-Type': 'application/json',
        'Origin': targetDomain,
        'Referer': `${targetDomain}/${folio}`,
      };

      // Agregar headers del body (X-Rem-Workflow, etc)
      if (req.body.headers && typeof req.body.headers === 'object') {
        Object.keys(req.body.headers).forEach(key => {
          headers[key] = req.body.headers[key];
        });
      }

      // Copiar cookies
      if (req.headers.cookie) {
        headers['Cookie'] = req.headers.cookie;
      }

      // Decodificar el campo 'body' que viene como base64 string
      let bodyData = req.body;
      
      if (req.body.body && typeof req.body.body === 'string') {
        try {
          // Intentar parsear como JSON primero
          bodyData = JSON.parse(req.body.body);
          console.log('[UPLOAD] Body parseado como JSON');
        } catch (e) {
          // Si falla, podría ser base64 - intentar decodificar
          try {
            const decoded = Buffer.from(req.body.body, 'base64').toString('utf8');
            bodyData = JSON.parse(decoded);
            console.log('[UPLOAD] Body decodificado de base64');
          } catch (e2) {
            // Si todo falla, usar el string original
            console.log('[UPLOAD] No se pudo decodificar body, usando string original');
            bodyData = req.body.body;
          }
        }
      }

      console.log('[UPLOAD] Body a enviar:', JSON.stringify(bodyData).substring(0, 300));
    console.log('[UPLOAD] Headers enviados:', JSON.stringify(headers, null, 2));

      requestConfig = {
        method: req.body.method || 'POST',
        url: apiUrl,
        data: bodyData,
        headers: headers,
        timeout: 60000,
        maxRedirects: 5,
        validateStatus: (status) => true,
      };

    } else {
      // Petición normal con archivos - usar form-data
      const formData = new FormData();
      
      Object.keys(req.body).forEach(key => {
        const value = req.body[key];
        if (typeof value === 'object') {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, String(value));
        }
      });

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          const timestamp = Date.now();
          const backupName = `${timestamp}_${file.originalname}`;
          const backupPath = path.join(UPLOAD_DIR, backupName);
          fs.writeFileSync(backupPath, file.buffer);
          console.log(`[BACKUP] Guardado: ${backupPath}`);

          formData.append(file.fieldname, file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype,
          });
        }
      }

      const headers = {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Language': 'es-MX,es;q=0.9',
        'Origin': targetDomain,
        'Referer': req.headers.referer || targetUrl,
        ...formData.getHeaders(),
      };

      if (req.headers.cookie) {
        headers['Cookie'] = req.headers.cookie;
      }

      requestConfig = {
        method: 'POST',
        url: apiUrl,
        data: formData,
        headers: headers,
        timeout: 60000,
        maxRedirects: 5,
        validateStatus: (status) => true,
      };
    }

    console.log(`[UPLOAD] Request method:`, requestConfig.method);
    console.log(`[UPLOAD] Request headers:`, JSON.stringify(requestConfig.headers, null, 2));
    console.log(`[UPLOAD] Request body:`, JSON.stringify(requestConfig.data, null, 2).substring(0, 500));

    // Reenviar al servidor original
    const response = await axios(requestConfig);

    // Propagar cookies de respuesta
    if (response.headers['set-cookie']) {
      res.setHeader('Set-Cookie', response.headers['set-cookie']);
    }

    // Propagar content-type
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }

    console.log(`[UPLOAD] Respuesta: ${response.status} ${response.statusText}`);
    console.log(`[UPLOAD] Content-Type:`, response.headers['content-type']);
    console.log(`[UPLOAD] Respuesta data (primer 200 chars):`, String(response.data).substring(0, 200));

    // Si la respuesta es HTML, modificarla
    const contentType = response.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      const modifiedHtml = modifyHtml(response.data, folio);
      return res.send(modifiedHtml);
    }

    res.status(response.status).send(response.data);

  } catch (error) {
    console.error('[ERROR] Upload:', error.message);
    console.error('[ERROR] Stack:', error.stack);
    
    const errorUrl = apiUrl || targetUrl || `${TARGET_DOMAIN}/${folio}`;
    
    // Si hay respuesta del servidor remoto, mostrarla modificada
    if (error.response) {
      const contentType = error.response.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        const modifiedHtml = modifyHtml(error.response.data, folio);
        return res.status(error.response.status).send(modifiedHtml);
      }
      return res.status(error.response.status).send(error.response.data);
    }
    
    // Error de conexión o timeout - mostrar página de error amigable
    res.status(500).send(`
      <html>
        <head>
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; text-align: center; background: #f5f5f5; }
            .container { background: white; max-width: 600px; margin: 50px auto; padding: 40px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); border-top: 4px solid #006633; }
            h2 { color: #c62828; margin-bottom: 20px; }
            .error-box { background: #ffebee; border-left: 4px solid #c62828; padding: 15px; margin: 20px 0; text-align: left; font-family: monospace; font-size: 0.9rem; color: #333; }
            .url-box { background: #e8f5e9; padding: 10px; margin: 15px 0; border-radius: 4px; word-break: break-all; font-family: monospace; font-size: 0.85rem; color: #006633; }
            a { display: inline-block; margin-top: 20px; padding: 12px 30px; background: #006633; color: white; text-decoration: none; border-radius: 4px; }
            a:hover { background: #009944; }
            .tip { color: #666; font-size: 0.9rem; margin-top: 20px; }
            .retry-btn { background: #1565c0; margin-left: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Error al Enviar Expediente</h2>
            <p>No se pudo conectar con el servidor remoto.</p>
            <div class="url-box">${errorUrl}</div>
            <div class="error-box">${error.message}</div>
            <p class="tip">Verifica tu conexion a internet o intenta nuevamente.</p>
            <a href="/">Volver al inicio</a>
            <a href="javascript:history.back()" class="retry-btn">Intentar de Nuevo</a>
          </div>
        </body>
      </html>
    `);
  }
});
// =====================================================
// FUNCIÓN DE MODIFICACIÓN DEL HTML
// =====================================================
function modifyHtml(html, folio) {
  const $ = cheerio.load(html);

  // ========== INYECCIÓN DE NUEVO DISEÑO ==========
  
  // CSS personalizado que sobrescribe el original
  const customStyles = `
    <style id="proxy-custom-styles">
      /* RESET Y NUEVO DISEÑO */
      :root {
        --primary-color: #006633;
        --secondary-color: #009944;
        --accent-color: #ffffff;
        --bg-color: #ffffff;
        --text-color: #1a1a1a;
        --success-color: #00b359;
        --error-color: #dc3545;
      }
      
      /* Ocultar elementos originales de branding */
      header img[src*="logo"],
      .logo, .brand, .original-brand,
      [class*="logo"], [id*="logo"],
      footer .original-footer {
        display: none !important;
      }
      
      /* Nuevo encabezado */
      body::before {
        content: '';
        display: block;
        height: 80px;
        background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
        position: relative;
      }
      
      /* Contenedor principal mejorado */
      main, .container, .content, #app, [role="main"] {
        background: white !important;
        border-radius: 12px !important;
        box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1) !important;
        margin: 20px auto !important;
        max-width: 900px !important;
        padding: 30px !important;
      }
      
      /* Botones estilizados */
      button, .btn, [type="submit"], [type="button"] {
        background: linear-gradient(135deg, var(--secondary-color), var(--primary-color)) !important;
        border: none !important;
        border-radius: 8px !important;
        color: white !important;
        padding: 12px 24px !important;
        font-weight: 600 !important;
        cursor: pointer !important;
        transition: all 0.3s ease !important;
      }
      
      button:hover, .btn:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 4px 12px rgba(43, 108, 176, 0.4) !important;
      }
      
      /* Inputs mejorados */
      input, select, textarea {
        border: 2px solid #e2e8f0 !important;
        border-radius: 8px !important;
        padding: 12px !important;
        transition: border-color 0.3s !important;
      }
      
      input:focus, select:focus, textarea:focus {
        border-color: var(--secondary-color) !important;
        outline: none !important;
        box-shadow: 0 0 0 3px rgba(43, 108, 176, 0.1) !important;
      }
      
      /* Área de carga de archivos destacada */
      input[type="file"] {
        background: #edf2f7 !important;
        border: 2px dashed var(--secondary-color) !important;
        padding: 30px !important;
        text-align: center !important;
      }
      
      /* Animaciones suaves */
      * {
        transition: opacity 0.3s ease, transform 0.3s ease !important;
      }
      
      /* Nuevo branding inyectado */
      .proxy-branding {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 10000;
        text-align: center;
      }
      
      .proxy-branding img.proxy-logo {
        width: 60px;
        height: 60px;
        margin-bottom: 10px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      
      .proxy-branding h1 {
        color: white;
        font-size: 22px;
        font-weight: 700;
        margin: 0;
        text-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      
      .proxy-badge {
        display: inline-block;
        background: white;
        color: var(--primary-color);
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        margin-top: 5px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
    </style>
  `;

  // HTML del nuevo branding
  const brandingHtml = `
    <div class="proxy-branding">
      <img src="/logo.svg" alt="HG Consultores" class="proxy-logo">
      <h1>HG Consultores</h1>
      <span class="proxy-badge">Folio: ${folio.substring(0, 20)}...</span>
    </div>
  `;

  // JavaScript para funcionalidad adicional
  const customScript = `
    <script id="proxy-custom-script">
      (function() {
        console.log('[Proxy] Sistema activo para folio: ${folio}');
        
        // Interceptar envío de formularios para mostrar loader
        document.addEventListener('submit', function(e) {
          const btn = e.target.querySelector('[type="submit"]');
          if (btn) {
            btn.dataset.originalText = btn.innerHTML;
            btn.innerHTML = 'Procesando...';
            btn.disabled = true;
          }
        });
        
        // Mejorar inputs de archivo con preview
        document.querySelectorAll('input[type="file"]').forEach(input => {
          input.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
              console.log('[Proxy] Archivo seleccionado:', file.name);
              
              // Crear preview si es imagen
              if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = function(event) {
                  let preview = input.parentElement.querySelector('.proxy-preview');
                  if (!preview) {
                    preview = document.createElement('img');
                    preview.className = 'proxy-preview';
                    preview.style.cssText = 'max-width: 200px; max-height: 200px; margin: 10px 0; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';
                    input.parentElement.appendChild(preview);
                  }
                  preview.src = event.target.result;
                };
                reader.readAsDataURL(file);
              }
            }
          });
        });
        
      })();
    </script>
  `;

  // ========== APLICAR MODIFICACIONES ==========
  
  // Insertar estilos en el head
  $('head').append(customStyles);
  
  // Insertar branding al inicio del body
  $('body').prepend(brandingHtml);
  
  // Insertar script al final
  $('body').append(customScript);
  
  // Modificar todos los links para mantenerse en el proxy
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('javascript')) {
      $(el).attr('href', '/' + folio + '/' + href.replace(/^\//, ''));
    }
  });
  
  // Modificar formularios para enviar al proxy
  $('form').each((i, el) => {
    const action = $(el).attr('action') || '';
    if (!action.startsWith('http')) {
      $(el).attr('action', '/' + folio);
    }
    $(el).attr('enctype', 'multipart/form-data');
  });
  
  // Reemplazar logos y favicons por logo local HG Consultores
  $('img[src*="logo"], img[src*="favicon"], img[src*="icon"], link[rel="icon"], link[rel="shortcut icon"]').each((i, el) => {
    const attr = el.tagName === 'LINK' ? 'href' : 'src';
    $(el).attr(attr, '/logo.svg');
  });
  
  // Reemplazar imágenes del dominio original
  $('img[src], link[href]').each((i, el) => {
    const attr = el.tagName === 'LINK' ? 'href' : 'src';
    const src = $(el).attr(attr);
    if (src && (src.includes('dimex') || src.includes('wflows'))) {
      // Si es logo, favicon o branding, reemplazar por logo local
      if (src.match(/(logo|favicon|icon|brand|header)/i)) {
        $(el).attr(attr, '/logo.svg');
      }
    }
  });
  
  // Modificar otros recursos estáticos externos
  $('img[src], link[href], script[src]').each((i, el) => {
    const attr = el.tagName === 'LINK' ? 'href' : 'src';
    const src = $(el).attr(attr);
    if (src && src.startsWith('http') && !src.includes('localhost') && !src.includes('127.0.0.1')) {
      // No reemplazar si ya es logo.svg
      if (!src.includes('/logo.svg')) {
        $(el).attr(attr, `/proxy-resource?url=${encodeURIComponent(src)}`);
      }
    }
  });

  return $.html();
}

// =====================================================
// INICIAR SERVIDOR CON REINICIO POR CTRL+R
// =====================================================
const readline = require('readline');

let server;

function startServer() {
  // En producción escuchar en 0.0.0.0, en local localhost
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
  
  server = app.listen(PORT, host, () => {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║     HG CONSULTORES - PROXY ACTIVO                     ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Puerto:        ${PORT}                                  ║`);
    console.log(`║  Host:          ${host}                              ║`);
    console.log(`║  Target:        ${TARGET_DOMAIN}              ║`);
    console.log(`║  URL:           http://${host}:${PORT}                     ║`);
    console.log('╚════════════════════════════════════════════════════════╝');
  });
  return server;
}

function restartServer() {
  console.log('\n[REINICIO] Cerrando servidor...');
  server.close(() => {
    console.log('[REINICIO] Servidor cerrado. Reiniciando...\n');
    startServer();
  });
}

// Iniciar servidor
startServer();

// Ctrl+R solo en desarrollo (cuando hay TTY)
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  
  process.stdin.on('keypress', (str, key) => {
    // Ctrl+C para salir
    if (key.ctrl && key.name === 'c') {
      console.log('\n[EXIT] Cerrando servidor...');
      process.exit(0);
    }
    
    // Ctrl+R para reiniciar
    if (key.ctrl && key.name === 'r') {
      restartServer();
    }
  });
  
  console.log('║  Ctrl+R = Reiniciar  |  Ctrl+C = Detener               ║');
}

module.exports = app;
