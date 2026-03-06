const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { dataDir } = require('../db');

const router = express.Router();
const entriesFile = path.join(dataDir, 'entries.json');

function loadJSON(f) { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} return []; }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

module.exports = function(upload) {
  // List entries
  router.get('/entries', (req, res) => {
    const e = loadJSON(entriesFile);
    e.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(e);
  });

  // Create entry
  router.post('/entries', upload.array('images', 4), (req, res) => {
    const { text, tag, parentId } = req.body;
    const images = (req.files || []).map(f => `/uploads/${f.filename}`);
    const entry = { id: uuidv4(), text: text || '', tag: tag || 'NOTE', images, parentId: parentId || null, createdAt: new Date().toISOString() };
    const entries = loadJSON(entriesFile);
    entries.push(entry);
    saveJSON(entriesFile, entries);
    res.status(201).json(entry);
  });

  // Edit entry
  router.put('/entries/:id', upload.array('images', 4), (req, res) => {
    const entries = loadJSON(entriesFile);
    const entry = entries.find(e => e.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    const { text, tag, keepImages } = req.body;
    if (text !== undefined) entry.text = text;
    if (tag !== undefined) entry.tag = tag;
    let kept = [];
    try { kept = JSON.parse(keepImages || '[]'); } catch {}
    (entry.images || []).filter(i => !kept.includes(i)).forEach(i => {
      const fp = path.join(__dirname, '..', '..', i);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    entry.images = [...kept, ...(req.files || []).map(f => `/uploads/${f.filename}`)];
    saveJSON(entriesFile, entries);
    res.json(entry);
  });

  // Delete entry + replies
  router.delete('/entries/:id', (req, res) => {
    let entries = loadJSON(entriesFile);
    const del = new Set();
    (function c(id) { del.add(id); entries.filter(e => e.parentId === id).forEach(e => c(e.id)); })(req.params.id);
    entries.filter(e => del.has(e.id)).forEach(e => (e.images || []).forEach(i => {
      const fp = path.join(__dirname, '..', '..', i);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }));
    saveJSON(entriesFile, entries.filter(e => !del.has(e.id)));
    res.json({ success: true });
  });

  return router;
};
