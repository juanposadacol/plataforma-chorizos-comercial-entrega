/**
 * Chorizos Granja Las Marías — correo de confirmación de pedido.
 *
 * Pegue este archivo COMPLETO en https://script.google.com (Editor → Código.gs),
 * publíquelo como aplicación web y guarde su URL y su secreto como secretos de
 * las Edge Functions de Supabase (nunca como variables VITE_ del navegador).
 *
 * Quién llama aquí: la Edge Function `process-email-outbox`, después de que el
 * pedido YA quedó guardado. Si este script falla, el pedido no se ve afectado:
 * el envío queda pendiente y se reintenta.
 *
 * Por qué el secreto viaja en el cuerpo y no en una cabecera: un Web App de
 * Apps Script no expone las cabeceras de la petición a doPost(e).
 */

/** Nombre del negocio tal como debe verse en el correo. */
var BUSINESS_NAME = 'Chorizos Granja Las Marías';

/** Asunto exacto pedido por el negocio. */
var SUBJECT = 'Pedido recibido - Chorizos Granja Las Marías';

/**
 * Punto de entrada del Web App.
 * Responde SIEMPRE en JSON; nunca lanza, para que el worker pueda decidir si
 * reintenta en vez de recibir una página de error HTML de Google.
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (!secretIsValid(body.secret)) {
      return jsonOutput({ ok: false, error: 'unauthorized' });
    }
    if (!body.customerEmail || !body.orderNumber) {
      return jsonOutput({ ok: false, error: 'invalid_payload' });
    }

    // Evita correos repetidos si el worker reintenta el mismo envío.
    var deliveryKey = 'sent:' + (body.deliveryId || body.orderNumber);
    var cache = CacheService.getScriptCache();
    if (cache.get(deliveryKey)) {
      return jsonOutput({ ok: true, duplicated: true });
    }

    MailApp.sendEmail({
      to: String(body.customerEmail),
      subject: SUBJECT,
      htmlBody: buildHtml(body),
      body: buildPlainText(body),
      name: BUSINESS_NAME,
    });

    // 6 horas: mucho más que cualquier ventana de reintentos del worker.
    cache.put(deliveryKey, '1', 21600);
    return jsonOutput({ ok: true, messageId: body.deliveryId || body.orderNumber });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error).slice(0, 300) });
  }
}

/** El navegador no debe poder usar esta URL para nada. */
function doGet() {
  return jsonOutput({ ok: false, error: 'method_not_allowed' });
}

/**
 * Compara el secreto recibido con el guardado en Propiedades del script.
 * La comparación recorre siempre la misma cantidad de caracteres para no
 * filtrar por tiempo cuántos coinciden.
 */
function secretIsValid(provided) {
  var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (!expected || typeof provided !== 'string') return false;
  var a = String(provided);
  var mismatch = a.length ^ expected.length;
  var size = Math.max(a.length, expected.length);
  for (var i = 0; i < size; i++) {
    mismatch |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0)
      ^ (expected.charCodeAt(i % Math.max(expected.length, 1)) || 0);
  }
  return mismatch === 0;
}

function jsonOutput(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

/** $ 1.234.567 — formato colombiano, sin decimales. */
function formatMoney(value) {
  var amount = Math.round(Number(value) || 0);
  var text = String(Math.abs(amount));
  var withDots = '';
  for (var i = 0; i < text.length; i++) {
    if (i > 0 && (text.length - i) % 3 === 0) withDots += '.';
    withDots += text.charAt(i);
  }
  return (amount < 0 ? '-$ ' : '$ ') + withDots;
}

/** Evita que un dato del pedido pueda inyectar etiquetas en el correo. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function itemRows(items) {
  var list = items && items.length ? items : [];
  var rows = '';
  for (var i = 0; i < list.length; i++) {
    var item = list[i] || {};
    rows +=
      '<tr>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e7d6bd;color:#2b211b;">' +
      escapeHtml(item.name) +
      '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e7d6bd;text-align:center;color:#2b211b;">' +
      escapeHtml(item.quantity) +
      '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e7d6bd;text-align:right;color:#78685d;">' +
      formatMoney(item.unitPrice) +
      '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e7d6bd;text-align:right;font-weight:bold;color:#2b211b;">' +
      formatMoney(item.subtotal) +
      '</td>' +
      '</tr>';
  }
  if (!rows) {
    rows =
      '<tr><td colspan="4" style="padding:12px;color:#78685d;">Detalle disponible con el negocio.</td></tr>';
  }
  return rows;
}

function totalRow(label, value, strong) {
  return (
    '<tr>' +
    '<td style="padding:4px 0;color:' +
    (strong ? '#4b100d' : '#78685d') +
    ';font-size:' +
    (strong ? '16px' : '14px') +
    ';font-weight:' +
    (strong ? 'bold' : 'normal') +
    ';">' +
    escapeHtml(label) +
    '</td>' +
    '<td style="padding:4px 0;text-align:right;color:' +
    (strong ? '#741d17' : '#2b211b') +
    ';font-size:' +
    (strong ? '18px' : '14px') +
    ';font-weight:bold;">' +
    formatMoney(value) +
    '</td>' +
    '</tr>'
  );
}

function buildHtml(order) {
  var notes = order.notes || 'Sin observaciones';
  var discount = Number(order.discount) || 0;

  return (
    '<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#fff9ed;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff9ed;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e7d6bd;border-radius:16px;overflow:hidden;">' +
    // Encabezado
    '<tr><td style="background:#741d17;padding:28px 28px 22px;">' +
    '<p style="margin:0;color:#f5cf7e;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Pedido recibido</p>' +
    '<h1 style="margin:8px 0 0;color:#ffffff;font-size:26px;font-family:Georgia,serif;">' +
    escapeHtml(BUSINESS_NAME) +
    '</h1>' +
    '</td></tr>' +
    // Saludo
    '<tr><td style="padding:26px 28px 4px;">' +
    '<p style="margin:0 0 10px;color:#2b211b;font-size:16px;">Hola <strong>' +
    escapeHtml(order.customerName) +
    '</strong>,</p>' +
    '<p style="margin:0;color:#78685d;font-size:15px;line-height:1.6;">Recibimos tu pedido y ya está registrado. Estos son los datos que tenemos; si algo no coincide, respóndenos este correo.</p>' +
    '</td></tr>' +
    // Número de pedido
    '<tr><td style="padding:18px 28px 0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7eddc;border-radius:12px;">' +
    '<tr><td style="padding:14px 16px;color:#78685d;font-size:14px;">Número de pedido</td>' +
    '<td style="padding:14px 16px;text-align:right;color:#741d17;font-family:Georgia,serif;font-size:20px;font-weight:bold;">' +
    escapeHtml(order.orderNumber) +
    '</td></tr></table></td></tr>' +
    // Productos
    '<tr><td style="padding:22px 28px 0;">' +
    '<h2 style="margin:0 0 10px;color:#4b100d;font-size:17px;font-family:Georgia,serif;">Tu pedido</h2>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">' +
    '<tr style="background:#f7eddc;">' +
    '<th align="left" style="padding:10px 12px;color:#78685d;font-size:12px;text-transform:uppercase;">Producto</th>' +
    '<th align="center" style="padding:10px 12px;color:#78685d;font-size:12px;text-transform:uppercase;">Cant.</th>' +
    '<th align="right" style="padding:10px 12px;color:#78685d;font-size:12px;text-transform:uppercase;">Vr. unit.</th>' +
    '<th align="right" style="padding:10px 12px;color:#78685d;font-size:12px;text-transform:uppercase;">Subtotal</th>' +
    '</tr>' +
    itemRows(order.items) +
    '</table></td></tr>' +
    // Totales
    '<tr><td style="padding:16px 28px 0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    totalRow('Subtotal', order.subtotal, false) +
    (discount > 0 ? totalRow('Descuento', -discount, false) : '') +
    totalRow('Domicilio', order.deliveryFee, false) +
    '<tr><td colspan="2" style="padding:6px 0;"><hr style="border:0;border-top:1px solid #e7d6bd;margin:0;"></td></tr>' +
    totalRow('Total', order.total, true) +
    '</table></td></tr>' +
    // Entrega
    '<tr><td style="padding:22px 28px 0;">' +
    '<h2 style="margin:0 0 10px;color:#4b100d;font-size:17px;font-family:Georgia,serif;">Entrega</h2>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#2b211b;">' +
    '<tr><td style="padding:4px 0;color:#78685d;width:150px;">Dirección</td><td style="padding:4px 0;">' +
    escapeHtml(order.address) +
    '</td></tr>' +
    '<tr><td style="padding:4px 0;color:#78685d;">Fecha solicitada</td><td style="padding:4px 0;">' +
    escapeHtml(order.requestedDate) +
    '</td></tr>' +
    '<tr><td style="padding:4px 0;color:#78685d;vertical-align:top;">Observaciones</td><td style="padding:4px 0;">' +
    escapeHtml(notes) +
    '</td></tr>' +
    '</table></td></tr>' +
    // Cierre
    '<tr><td style="padding:24px 28px 28px;">' +
    '<p style="margin:0;color:#78685d;font-size:13px;line-height:1.6;">Este correo confirma que el pedido quedó registrado. El valor final y la entrega se confirman con el negocio.</p>' +
    '</td></tr>' +
    '<tr><td style="background:#f7eddc;padding:16px 28px;text-align:center;color:#78685d;font-size:12px;">' +
    escapeHtml(BUSINESS_NAME) +
    ' · Gracias por tu compra' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}

/** Versión sin formato, para clientes de correo que no muestran HTML. */
function buildPlainText(order) {
  var lines = [];
  lines.push(BUSINESS_NAME);
  lines.push('Pedido recibido: ' + order.orderNumber);
  lines.push('');
  lines.push('Hola ' + order.customerName + ', recibimos tu pedido.');
  lines.push('');
  var items = order.items || [];
  for (var i = 0; i < items.length; i++) {
    lines.push('- ' + items[i].name + ' x' + items[i].quantity + '  ' + formatMoney(items[i].subtotal));
  }
  lines.push('');
  lines.push('Total: ' + formatMoney(order.total));
  lines.push('Dirección: ' + order.address);
  lines.push('Fecha solicitada: ' + order.requestedDate);
  lines.push('Observaciones: ' + (order.notes || 'Sin observaciones'));
  return lines.join('\n');
}

/**
 * Prueba manual desde el editor de Apps Script: Ejecutar → probarCorreo.
 * Envía un correo de ejemplo a la cuenta con la que abrió el editor.
 */
function probarCorreo() {
  var email = Session.getActiveUser().getEmail();
  MailApp.sendEmail({
    to: email,
    subject: SUBJECT,
    htmlBody: buildHtml({
      orderNumber: 'PED-DE-PRUEBA',
      customerName: 'Cliente de prueba',
      items: [
        { name: 'Chorizo Argentino', quantity: 4, unitPrice: 16000, subtotal: 64000 },
        { name: 'Chorizo Jalapeño', quantity: 2, unitPrice: 16000, subtotal: 32000 },
      ],
      subtotal: 96000,
      discount: 0,
      deliveryFee: 5000,
      total: 101000,
      address: 'Calle 10 # 20-30, El Playón, Medellín',
      requestedDate: '10/08/2026',
      notes: '',
    }),
    name: BUSINESS_NAME,
  });
  Logger.log('Correo de prueba enviado a ' + email);
}
