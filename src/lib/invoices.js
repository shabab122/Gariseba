'use strict';
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { clean, digits } = require('./validate');
const { HttpError } = require('./http');

const invalid = (message) => new HttpError(422, 'validation', message);
const money = (poisha) => (poisha / 100).toFixed(2);

function parseMoney(value) {
  const text = typeof value === 'number' ? String(value) : digits(typeof value === 'string' ? value.trim() : '');
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) throw invalid('Enter an amount with up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function invoiceFields(body) {
  if (!body || !Array.isArray(body.items) || !body.items.length || body.items.length > 20) {
    throw invalid('Add between 1 and 20 bill items.');
  }
  const items = body.items.map((item) => {
    if (!item || typeof item.description !== 'string' || item.description.length > 140) throw invalid('Use an item description up to 140 characters.');
    const description = clean(item.description, 140);
    if (!description || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) throw invalid('Each item needs a description and a whole quantity from 1 to 999.');
    const unit_poisha = parseMoney(item.unit_bdt);
    return { description, quantity: item.quantity, unit_poisha, line_poisha: unit_poisha * item.quantity };
  });
  const subtotal_poisha = items.reduce((sum, item) => sum + item.line_poisha, 0);
  const discount_poisha = parseMoney(body.discount_bdt ?? '0');
  if (discount_poisha > subtotal_poisha) throw invalid('The discount cannot exceed the subtotal.');
  if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 1500)) throw invalid('Bill notes must be text up to 1500 characters.');
  return { items, subtotal_poisha, discount_poisha, total_poisha: subtotal_poisha - discount_poisha, notes: clean(body.notes, 1500) };
}

function makeInvoice(row, fields, actor, now = new Date()) {
  return {
    ...fields, number: 'GS-' + row.public_code, revision: (row.invoice?.revision || 0) + 1,
    issued_at: row.invoice?.issued_at || now, updated_at: now, issued_by: actor,
    customer: { name: row.customer_name, phone: row.callback_phone },
    vehicle: [row.vehicle_make, row.vehicle_model, row.vehicle_year].filter(Boolean).join(' '),
    registration: row.registration || '', request_code: row.public_code,
  };
}

function requireInvoice(row) {
  if (row.status !== 'completed' || !row.invoice) throw new HttpError(409, 'bill_unavailable', 'A PDF bill is available after the service is completed and staff saves the bill.');
  return row.invoice;
}

function renderInvoice(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, left: 48, right: 48, bottom: 80 }, bufferPages: true,
      info: { Title: invoice.number, Author: 'GariSeba', Subject: 'Service invoice' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.once('error', reject);
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    try {
      doc.registerFont('Latin', path.join(__dirname, '../../assets/fonts/NotoSans-Regular.ttf'));
      doc.registerFont('LatinBold', path.join(__dirname, '../../assets/fonts/NotoSans-Bold.ttf'));
      doc.registerFont('Bangla', path.join(__dirname, '../../assets/fonts/NotoSansBengali-Regular.ttf'));
      const width = doc.page.width - 96;
      function room(height = 90) { if (doc.y + height > doc.page.height - 75) doc.addPage(); }
      function text(value, size = 11, options = {}) {
        const parts = String(value || '-').split(/([\u0964\u0965\u0980-\u09FF\u200C\u200D]+)/u).filter(Boolean);
        doc.fontSize(size).fillColor('#273d46');
        for (let i = 0; i < parts.length; i++) {
          doc.font(/[\u0964\u0965\u0980-\u09FF\u200C\u200D]/u.test(parts[i]) ? 'Bangla' : 'Latin')
            .text(parts[i], { width, lineGap: 4, ...options, continued: i < parts.length - 1 });
        }
      }
      doc.fillColor('#11665f').font('LatinBold').fontSize(29).text('GariSeba');
      doc.fillColor('#5d7077').font('Latin').fontSize(10).text('DHAKA | SERVICE INVOICE');
      doc.moveDown(1.2);
      doc.fillColor('#17323c').font('LatinBold').fontSize(18).text(invoice.number);
      const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', dateStyle: 'medium', timeStyle: 'short' });
      text('Issued: ' + date.format(new Date(invoice.issued_at)) + ' (Dhaka) | Revision ' + invoice.revision, 10);
      if (invoice.revision > 1) text('Updated: ' + date.format(new Date(invoice.updated_at)) + ' (Dhaka)', 10);
      doc.moveDown();
      text('Customer: ' + invoice.customer.name);
      text('Contact: ' + invoice.customer.phone);
      text('Vehicle: ' + invoice.vehicle + (invoice.registration ? ' | ' + invoice.registration : ''));
      text('Request: ' + invoice.request_code);
      doc.moveDown();
      function headings() {
        const y = doc.y;
        doc.save().rect(48, y, width, 27).fill('#edf5f3').restore();
        doc.fillColor('#17323c').font('LatinBold').fontSize(10).text('DESCRIPTION', 58, y + 9);
        doc.text('BDT', 410, y + 9, { width: 125, align: 'right' });
        doc.x = 48; doc.y = y + 38;
      }
      headings();
      for (const item of invoice.items) {
        if (doc.y + 125 > doc.page.height - 75) { doc.addPage(); headings(); }
        const y = doc.y;
        text(item.description, 11, { width: 350 });
        const bottom = doc.y;
        doc.font('LatinBold').fontSize(11).fillColor('#17323c')
          .text(money(item.line_poisha), 410, y, { width: 125, align: 'right' });
        doc.x = 48; doc.y = Math.max(bottom, y + 15);
        text('Quantity ' + item.quantity + '  x  BDT ' + money(item.unit_poisha), 9);
        doc.moveDown(0.5);
        doc.save().strokeColor('#dce7e4').moveTo(48, doc.y).lineTo(547, doc.y).stroke().restore();
        doc.moveDown(0.7);
      }
      room(115);
      text('Subtotal: BDT ' + money(invoice.subtotal_poisha), 11, { align: 'right' });
      text('Discount: BDT ' + money(invoice.discount_poisha), 11, { align: 'right' });
      doc.font('LatinBold').fontSize(17).fillColor('#11665f')
        .text('TOTAL  BDT ' + money(invoice.total_poisha), { width, align: 'right' });
      doc.moveDown();
      if (invoice.notes) { room(); text('Bill notes', 12); text(invoice.notes, 10); doc.moveDown(); }
      room(45);
      text('This invoice records the service charges. Payment confirmation is handled separately by the team.', 9);
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        const bottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('Latin').fontSize(8).fillColor('#5d7077')
          .text('GariSeba | ' + invoice.number + ' | Page ' + (i + 1) + ' of ' + pages.count,
            48, doc.page.height - 40, { width, align: 'center', lineBreak: false });
        doc.page.margins.bottom = bottomMargin;
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}

async function sendInvoice(res, row) {
  const invoice = requireInvoice(row);
  const pdf = await renderInvoice(invoice);
  res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="' + invoice.number.replace(/[^A-Za-z0-9-]/g, '') + '.pdf"' }).send(pdf);
}

module.exports = { parseMoney, invoiceFields, makeInvoice, requireInvoice, renderInvoice, sendInvoice, money };
