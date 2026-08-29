const { app } = require('@azure/functions');
const { getPool, sql } = require('../db');

// ============================================================
// GET/POST /api/words
// Referans tabanlı mimari: Nomen/Verben/Adjektiv sadece
// (UserId, MasterWordId, Correct, Wrong, Streak) tutar.
// Kelime verisi (kelime, çeviri, çekim) MasterWords + 
// MasterTranslations'tan JOIN ile gelir.
// Seviye/Bölüm ProgramCurriculum'dan (kullanıcının ProgramAdi'sine göre) gelir.
// ============================================================

app.http('words', {
  methods: ['GET', 'POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'words',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') return json({});
    try {
      let body = {};
      if (request.method === 'POST') {
        body = await request.json();
      } else {
        const params = new URL(request.url).searchParams;
        params.forEach((v, k) => body[k] = v);
      }

      const action = body.action;
      if (!action) return json({ error: 'action eksik' }, 400);

      switch (action) {
        case 'ensureUser': return json(await ensureUser(body));
        case 'setUserLang': return json(await setUserLang(body));
        case 'setUserProgram': return json(await setUserProgram(body));
        case 'getPrograms': return json(await getPrograms());
        case 'getSummary': return json(await getSummary(body));
        case 'syncDelta': return json(await syncDelta(body));
        case 'getAllLight': return json(await getAllLight(body));
        case 'getWordDetail': return json(await getWordDetail(body));
        case 'addWord': return json(await addWord(body));
        case 'update': return json(await updateWord(body));
        case 'delete': return json(await deleteWord(body));
        case 'importCSV': return json(await importCSV(body));
        case 'masterPreview': return json(await masterPreview(body));
        case 'masterImport': return json(await masterImport(body));
        case 'getLists': return json(await getLists(body));
        case 'saveList': return json(await saveList(body));
        case 'deleteList': return json(await deleteList(body));
        case 'addToList': return json(await addToList(body));
        case 'removeFromList': return json(await removeFromList(body));
        case 'getListWords': return json(await getListWords(body));
        case 'getSentences': return json(await getSentences(body));
        case 'getSentencesByProgram': return json(await getSentencesByProgram(body));
        case 'getTexts': return json(await getTexts(body));
        case 'getText': return json(await getText(body));
        case 'logSession': return json(await logSession(body));
        case 'logTest': return json(await logTest(body));
        case 'logAiUsage': return json(await logAiUsage(body));
        case 'getUserReport': return json(await getUserReport(body));
        case 'getAdminReport': return json(await getAdminReport(body));
        default: return json({ error: 'Bilinmeyen işlem: ' + action }, 400);
      }
    } catch (err) {
      context.error(err);
      return json({ error: err.message }, 500);
    }
  }
});

function json(obj, status = 200) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(obj)
  };
}

function colNameFor(tur) {
  if (tur === 'noun') return 'nomen';
  if (tur === 'verb') return 'verben';
  return 'adjektiv';
}
function tableFor(tur) {
  if (tur === 'noun') return 'Nomen';
  if (tur === 'verb') return 'Verben';
  return 'Adjektiv';
}

// ----------------------------------------------------------
// Kullanıcı profili oluştur/getir
// ----------------------------------------------------------
async function ensureUser({ userId, email }) {
  const pool = await getPool();
  const existing = await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .query('SELECT UserId, Email, AnaDil, KullaniciTipi, ProgramAdi FROM Users WHERE UserId=@userId');

  if (existing.recordset.length > 0) {
    return { success: true, profile: existing.recordset[0] };
  }

  await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('email', sql.NVarChar(255), email)
    .query("INSERT INTO Users (UserId, Email, KullaniciTipi, ProgramAdi) VALUES (@userId, @email, 1, 'Klett')");

  return { success: true, profile: { UserId: userId, Email: email, AnaDil: null, KullaniciTipi: 1, ProgramAdi: 'Klett' } };
}

async function setUserLang({ userId, anaAil }) {
  const pool = await getPool();
  await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('anaAil', sql.NVarChar(10), anaAil)
    .query('UPDATE Users SET AnaDil=@anaAil WHERE UserId=@userId');
  return { success: true };
}

async function setUserProgram({ userId, programAdi }) {
  const pool = await getPool();
  await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('programAdi', sql.NVarChar(100), programAdi)
    .query('UPDATE Users SET ProgramAdi=@programAdi WHERE UserId=@userId');
  return { success: true };
}

async function getPrograms() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT DISTINCT ProgramAdi FROM ProgramCurriculum ORDER BY ProgramAdi');
  return { success: true, programs: result.recordset.map(r => r.ProgramAdi) };
}

// ----------------------------------------------------------
// Kullanıcının programını al (yardımcı)
// ----------------------------------------------------------
async function getUserProgram(pool, userId) {
  const r = await pool.request().input('userId', sql.NVarChar(128), userId).query('SELECT ProgramAdi, AnaDil FROM Users WHERE UserId=@userId');
  if (!r.recordset.length) return { programAdi: 'Klett', anaAil: 'tr' };
  return { programAdi: r.recordset[0].ProgramAdi || 'Klett', anaAil: r.recordset[0].AnaDil || 'tr' };
}

// ----------------------------------------------------------
// Özet (sadece sayılar)
// ----------------------------------------------------------
async function getSummary({ userId }) {
  const pool = await getPool();
  const [n, v, a] = await Promise.all([
    pool.request().input('userId', sql.NVarChar(128), userId).query('SELECT COUNT(*) as cnt FROM Nomen WHERE UserId=@userId'),
    pool.request().input('userId', sql.NVarChar(128), userId).query('SELECT COUNT(*) as cnt FROM Verben WHERE UserId=@userId'),
    pool.request().input('userId', sql.NVarChar(128), userId).query('SELECT COUNT(*) as cnt FROM Adjektiv WHERE UserId=@userId')
  ]);
  return { success: true, counts: { nomen: n.recordset[0].cnt, verben: v.recordset[0].cnt, adjektiv: a.recordset[0].cnt } };
}

// ----------------------------------------------------------
// Hafif kelime listesi — JOIN ile MasterWords + ProgramCurriculum + MasterTranslations
// ----------------------------------------------------------
// ----------------------------------------------------------
// Delta sync — son syncten bu yana değişen kelimeler
// lastSync: ISO string (ör. "2026-08-25T10:00:00.000Z")
// Sadece o tarihten sonra UpdatedAt olan kayıtları döndürür.
// IsDeleted=1 olanlar da gelir (frontend bunları siler).
// Kullanıcı son syncten bu yana login olmamışsa boş döner.
// ----------------------------------------------------------
async function syncDelta({ userId, lastSync }) {
  if (!userId || !lastSync) return { success: false, error: 'userId veya lastSync eksik' };

  const pool = await getPool();

  // Kullanıcı son syncten bu yana login olmuş mu?
  const sessionCheck = await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('lastSync', sql.DateTime2, new Date(lastSync))
    .query(`SELECT TOP 1 Id FROM UserSessions WHERE UserId=@userId AND LoginTime > @lastSync`);

  if (sessionCheck.recordset.length === 0) {
    return { success: true, changed: [], deleted: [], noActivity: true };
  }

  const { programAdi, anaAil } = await getUserProgram(pool, userId);
  const since = new Date(lastSync);

  const [nomen, verben, adjektiv] = await Promise.all([
    pool.request()
      .input('userId', sql.NVarChar(128), userId)
      .input('since', sql.DateTime2, since)
      .input('program', sql.NVarChar(100), programAdi)
      .input('dil', sql.NVarChar(10), anaAil)
      .query(`SELECT n.Id, mw.Id as MasterWordId, mw.AlmancaKelime as word, mw.Cogul as plural, mt.Ceviri as tr,
                     COALESCE(pc.Seviye,'') as level, COALESCE(pc.Bolum,'Andere') as chapter,
                     n.Correct as correct, n.Wrong as wrong, n.Streak as streak, n.IsDeleted as isDeleted
              FROM Nomen n
              JOIN MasterWords mw ON mw.Id = n.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId = mw.Id AND mt.Dil = @dil
              LEFT JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
              WHERE n.UserId = @userId AND n.UpdatedAt > @since`),
    pool.request()
      .input('userId', sql.NVarChar(128), userId)
      .input('since', sql.DateTime2, since)
      .input('program', sql.NVarChar(100), programAdi)
      .input('dil', sql.NVarChar(10), anaAil)
      .query(`SELECT v.Id, mw.Id as MasterWordId, mw.AlmancaKelime as word, mt.Ceviri as tr,
                     COALESCE(pc.Seviye,'') as level, COALESCE(pc.Bolum,'Andere') as chapter,
                     v.Correct as correct, v.Wrong as wrong, v.Streak as streak, v.IsDeleted as isDeleted
              FROM Verben v
              JOIN MasterWords mw ON mw.Id = v.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId = mw.Id AND mt.Dil = @dil
              LEFT JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
              WHERE v.UserId = @userId AND v.UpdatedAt > @since`),
    pool.request()
      .input('userId', sql.NVarChar(128), userId)
      .input('since', sql.DateTime2, since)
      .input('program', sql.NVarChar(100), programAdi)
      .input('dil', sql.NVarChar(10), anaAil)
      .query(`SELECT a.Id, mw.Id as MasterWordId, mw.Tur as type, mw.AlmancaKelime as word, mt.Ceviri as tr, mw.Ekbilgi as extra,
                     COALESCE(pc.Seviye,'') as level, COALESCE(pc.Bolum,'Andere') as chapter,
                     a.Correct as correct, a.Wrong as wrong, a.Streak as streak, a.IsDeleted as isDeleted
              FROM Adjektiv a
              JOIN MasterWords mw ON mw.Id = a.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId = mw.Id AND mt.Dil = @dil
              LEFT JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
              WHERE a.UserId = @userId AND a.UpdatedAt > @since`)
  ]);

  const changed = [];
  const deleted = [];

  nomen.recordset.forEach(r => {
    const obj = { _id: 'n_' + r.Id, _col: 'nomen', _mwid: r.MasterWordId, type: 'noun', word: r.word, plural: r.plural, tr: r.tr || '', level: r.level, chapter: r.chapter, correct: r.correct, wrong: r.wrong, streak: r.streak };
    if (r.isDeleted) deleted.push('n_' + r.Id);
    else changed.push(obj);
  });
  verben.recordset.forEach(r => {
    const obj = { _id: 'v_' + r.Id, _col: 'verben', _mwid: r.MasterWordId, type: 'verb', word: r.word, tr: r.tr || '', level: r.level, chapter: r.chapter, correct: r.correct, wrong: r.wrong, streak: r.streak };
    if (r.isDeleted) deleted.push('v_' + r.Id);
    else changed.push(obj);
  });
  adjektiv.recordset.forEach(r => {
    const obj = { _id: 'a_' + r.Id, _col: 'adjektiv', _mwid: r.MasterWordId, type: r.type || 'adj', word: r.word, tr: r.tr || '', extra: r.extra, level: r.level, chapter: r.chapter, correct: r.correct, wrong: r.wrong, streak: r.streak };
    if (r.isDeleted) deleted.push('a_' + r.Id);
    else changed.push(obj);
  });

  return { success: true, changed, deleted, syncTime: new Date().toISOString() };
}

async function getAllLight({ userId }) {
  const pool = await getPool();
  const { programAdi, anaAil } = await getUserProgram(pool, userId);

  const [nomen, verben, adjektiv] = await Promise.all([
    pool.request().input('userId', sql.NVarChar(128), userId).input('program', sql.NVarChar(100), programAdi).input('dil', sql.NVarChar(10), anaAil).query(`
      SELECT n.Id, mw.Id as MasterWordId, mw.AlmancaKelime as word, mw.Cogul as plural, mt.Ceviri as tr,
             COALESCE(pc.Seviye,'') as level, COALESCE(pc.Bolum,'Andere') as chapter,
             n.Correct as correct, n.Wrong as wrong, n.Streak as streak
      FROM Nomen n
      JOIN MasterWords mw ON mw.Id = n.MasterWordId
      LEFT JOIN MasterTranslations mt ON mt.MasterWordId = mw.Id AND mt.Dil = @dil
      LEFT JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
      WHERE n.UserId = @userId AND n.IsDeleted=0 ORDER BY n.Id`),
    pool.request().input('userId', sql.NVarChar(128), userId).input('program', sql.NVarChar(100), programAdi).input('dil', sql.NVarChar(10), anaAil).query(`
      SELECT v.Id, mw.Id as MasterWordId, mw.AlmancaKelime as word, mt.Ceviri as tr,
             COALESCE(pc.Seviye,'') as level, COALESCE(pc.Bolum,'Andere') as chapter,
             v.Correct as correct, v.Wrong as wrong, v.Streak as streak
      FROM Verben v
      JOIN MasterWords mw ON mw.Id = v.MasterWordId
      LEFT JOIN MasterTranslations mt ON mt.MasterWordId = mw.Id AND mt.Dil = @dil
      LEFT JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
      WHERE v.UserId = @userId AND v.IsDeleted=0 ORDER BY v.Id`),
    pool.request().input('userId', sql.NVarChar(128), userId).input('program', sql.NVarChar(100), programAdi).input('dil', sql.NVarChar(10), anaAil).query(`
      SELECT a.Id, mw.Id as MasterWordId, mw.Tur as type, mw.AlmancaKelime as word, mt.Ceviri as tr, mw.Ekbilgi as extra,
             COALESCE(pc.Seviye,'') as level, COALESCE(pc.Bolum,'Andere') as chapter,
             a.Correct as correct, a.Wrong as wrong, a.Streak as streak
      FROM Adjektiv a
      JOIN MasterWords mw ON mw.Id = a.MasterWordId
      LEFT JOIN MasterTranslations mt ON mt.MasterWordId = mw.Id AND mt.Dil = @dil
      LEFT JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
      WHERE a.UserId = @userId AND a.IsDeleted=0 ORDER BY a.Id`)
  ]);

  const words = [];
  nomen.recordset.forEach(r => words.push({ _id: 'n_' + r.Id, _col: 'nomen', _mwid: r.MasterWordId, type: 'noun', word: r.word, plural: r.plural, tr: r.tr || '', level: r.level, chapter: r.chapter, correct: r.correct, wrong: r.wrong, streak: r.streak }));
  verben.recordset.forEach(r => words.push({ _id: 'v_' + r.Id, _col: 'verben', _mwid: r.MasterWordId, type: 'verb', word: r.word, tr: r.tr || '', level: r.level, chapter: r.chapter, correct: r.correct, wrong: r.wrong, streak: r.streak }));
  adjektiv.recordset.forEach(r => words.push({ _id: 'a_' + r.Id, _col: 'adjektiv', _mwid: r.MasterWordId, type: r.type || 'adj', word: r.word, tr: r.tr || '', extra: r.extra, level: r.level, chapter: r.chapter, correct: r.correct, wrong: r.wrong, streak: r.streak }));

  return { success: true, words, counts: { nomen: nomen.recordset.length, verben: verben.recordset.length, adjektiv: adjektiv.recordset.length } };
}

// ----------------------------------------------------------
// Tek kelime tam detay (çekimler dahil) — JOIN ile
// ----------------------------------------------------------
async function getWordDetail({ _id, _col, userId, anaAil }) {
  const pool = await getPool();
  const id = parseInt(_id.split('_')[1]);
  const table = tableFor(_col === 'nomen' ? 'noun' : _col === 'verben' ? 'verb' : 'adj');
  let dil = anaAil;
  if (!dil && userId) { const up = await getUserProgram(pool, userId); dil = up.anaAil; }
  dil = dil || 'tr';

  const r = await pool.request()
    .input('id', sql.Int, id)
    .input('dil', sql.NVarChar(10), dil)
    .query(`SELECT u.Id, mw.*, mt.Ceviri, u.Correct, u.Wrong, u.Streak
            FROM ${table} u
            JOIN MasterWords mw ON mw.Id = u.MasterWordId
            LEFT JOIN MasterTranslations mt ON mt.MasterWordId = mw.Id AND mt.Dil = @dil
            WHERE u.Id = @id`);

  if (!r.recordset.length) return { success: false };
  const w = r.recordset[0];

  if (_col === 'nomen') {
    return { success: true, word: { _id, _col, _mwid: w.MasterWordId, type: 'noun', word: w.AlmancaKelime, plural: w.Cogul, tr: w.Ceviri || '', correct: w.Correct, wrong: w.Wrong, streak: w.Streak } };
  } else if (_col === 'verben') {
    return { success: true, word: { _id, _col, _mwid: w.MasterWordId, type: 'verb', word: w.AlmancaKelime, tr: w.Ceviri || '', correct: w.Correct, wrong: w.Wrong, streak: w.Streak,
      praesens: { ich: w.Ich, du: w.Du, er: w.Er, wir: w.Wir, ihr: w.Ihr, sie: w.Sie },
      perfekt: w.Perfekt, praeteritum: w.Praeteritum, futur1: w.Futur1, futur2: w.Futur2, plusquam: w.Plusquamperfekt } };
  } else {
    return { success: true, word: { _id, _col, _mwid: w.MasterWordId, type: w.Tur || 'adj', word: w.AlmancaKelime, tr: w.Ceviri || '', extra: w.Ekbilgi, correct: w.Correct, wrong: w.Wrong, streak: w.Streak } };
  }
}

// ----------------------------------------------------------
// Yeni kelime ekle — MasterWords'te ara, yoksa yeni oluştur
// word: { type, word, tr, plural?, praesens?, perfekt?, ..., extra?, level?, chapter?, sentences? }
// ----------------------------------------------------------
async function addWord({ userId, word }) {
  const pool = await getPool();
  const { programAdi, anaAil } = await getUserProgram(pool, userId);
  const table = tableFor(word.type);
  const colName = colNameFor(word.type === 'verb' ? 'verb' : word.type === 'noun' ? 'noun' : 'adj');

  // 1) MasterWords'te bu kelime var mı? (büyük/küçük harf duyarsız)
  const mExisting = await pool.request()
    .input('kelime', sql.NVarChar(200), word.word)
    .query('SELECT Id FROM MasterWords WHERE LOWER(AlmancaKelime)=LOWER(@kelime)');

  let masterWordId;
  if (mExisting.recordset.length > 0) {
    masterWordId = mExisting.recordset[0].Id;
  } else {
    const p = word.praesens || {};
    const mResult = await pool.request()
      .input('tur', sql.NVarChar(10), word.type)
      .input('kelime', sql.NVarChar(200), word.word)
      .input('cogul', sql.NVarChar(200), word.plural || '')
      .input('ich', sql.NVarChar(200), p.ich || '')
      .input('du', sql.NVarChar(200), p.du || '')
      .input('er', sql.NVarChar(200), p.er || '')
      .input('wir', sql.NVarChar(200), p.wir || '')
      .input('ihr', sql.NVarChar(200), p.ihr || '')
      .input('sie', sql.NVarChar(200), p.sie || '')
      .input('perfekt', sql.NVarChar(200), word.perfekt || '')
      .input('praeteritum', sql.NVarChar(200), word.praeteritum || '')
      .input('futur1', sql.NVarChar(200), word.futur1 || '')
      .input('futur2', sql.NVarChar(200), word.futur2 || '')
      .input('plusquam', sql.NVarChar(200), word.plusquam || '')
      .input('ekbilgi', sql.NVarChar(500), word.extra || '')
      .query(`INSERT INTO MasterWords (Tur, AlmancaKelime, Cogul, Ich, Du, Er, Wir, Ihr, Sie, Perfekt, Praeteritum, Futur1, Futur2, Plusquamperfekt, Ekbilgi)
              OUTPUT INSERTED.Id
              VALUES (@tur, @kelime, @cogul, @ich, @du, @er, @wir, @ihr, @sie, @perfekt, @praeteritum, @futur1, @futur2, @plusquam, @ekbilgi)`);
    masterWordId = mResult.recordset[0].Id;

    if (word.tr) {
      try {
        await pool.request()
          .input('masterWordId', sql.Int, masterWordId)
          .input('dil', sql.NVarChar(10), anaAil)
          .input('ceviri', sql.NVarChar(500), word.tr)
          .query('INSERT INTO MasterTranslations (MasterWordId, Dil, Ceviri) VALUES (@masterWordId, @dil, @ceviri)');
      } catch (e) { /* çakışma */ }
    }
  }

  // 2) ProgramCurriculum'da bu kelime + kullanıcının programı var mı?
  const pcExisting = await pool.request()
    .input('masterWordId', sql.Int, masterWordId)
    .input('program', sql.NVarChar(100), programAdi)
    .query('SELECT Id FROM ProgramCurriculum WHERE MasterWordId=@masterWordId AND ProgramAdi=@program');

  if (pcExisting.recordset.length === 0) {
    await pool.request()
      .input('masterWordId', sql.Int, masterWordId)
      .input('program', sql.NVarChar(100), programAdi)
      .input('seviye', sql.NVarChar(10), word.level || 'A1.1')
      .input('bolum', sql.NVarChar(50), word.chapter || 'Andere')
      .query('INSERT INTO ProgramCurriculum (MasterWordId, ProgramAdi, Seviye, Bolum) VALUES (@masterWordId, @program, @seviye, @bolum)');
  }

  // 3) Kullanıcının kendi tablosunda bu MasterWordId zaten var mı?
  const uExisting = await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('masterWordId', sql.Int, masterWordId)
    .query(`SELECT Id FROM ${table} WHERE UserId=@userId AND MasterWordId=@masterWordId`);

  if (uExisting.recordset.length > 0) {
    return { success: false, error: 'Dieses Wort existiert bereits!', duplicate: true };
  }

  const insertResult = await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('masterWordId', sql.Int, masterWordId)
    .query(`INSERT INTO ${table} (UserId, MasterWordId) OUTPUT INSERTED.Id VALUES (@userId, @masterWordId)`);

  const newId = insertResult.recordset[0].Id;

  // 4) Örnek cümleler varsa kaydet
  if (word.sentences && word.sentences.length) {
    for (const s of word.sentences) {
      if (!s.de) continue;
      try {
        await pool.request()
          .input('masterWordId', sql.Int, masterWordId)
          .input('almanca', sql.NVarChar(1000), s.de)
          .input('dil', sql.NVarChar(10), anaAil)
          .input('ceviri', sql.NVarChar(1000), s.tr || '')
          .query(`IF NOT EXISTS (SELECT 1 FROM Sentences WHERE MasterWordId=@masterWordId AND AlmancaCumle=@almanca AND Dil=@dil)
                  INSERT INTO Sentences (MasterWordId, AlmancaCumle, Dil, CeviriCumle)
                  VALUES (@masterWordId, @almanca, @dil, @ceviri)`);
      } catch (e) { /* çakışma */ }
    }
  }

  return { success: true, _id: (colName === 'nomen' ? 'n_' : colName === 'verben' ? 'v_' : 'a_') + newId, _col: colName };
}

// ----------------------------------------------------------
// İstatistik güncelle
// ----------------------------------------------------------
async function updateWord({ userId, _id, _col, correct, wrong, streak }) {
  const pool = await getPool();
  const id = parseInt(_id.split('_')[1]);
  const table = _col === 'nomen' ? 'Nomen' : _col === 'verben' ? 'Verben' : 'Adjektiv';

  await pool.request()
    .input('id', sql.Int, id)
    .input('userId', sql.NVarChar(128), userId)
    .input('correct', sql.Int, correct || 0)
    .input('wrong', sql.Int, wrong || 0)
    .input('streak', sql.Int, streak || 0)
    .query(`UPDATE ${table} SET Correct=@correct, Wrong=@wrong, Streak=@streak, UpdatedAt=SYSUTCDATETIME() WHERE Id=@id AND UserId=@userId`);

  return { success: true };
}

async function deleteWord({ userId, _id, _col }) {
  const pool = await getPool();
  const id = parseInt(_id.split('_')[1]);
  const table = _col === 'nomen' ? 'Nomen' : _col === 'verben' ? 'Verben' : 'Adjektiv';

  await pool.request()
    .input('id', sql.Int, id)
    .input('userId', sql.NVarChar(128), userId)
    .query(`UPDATE ${table} SET IsDeleted=1, UpdatedAt=SYSUTCDATETIME() WHERE Id=@id AND UserId=@userId`);

  return { success: true };
}

// ----------------------------------------------------------
// CSV toplu içe aktarma
// ----------------------------------------------------------
async function importCSV({ userId, grp, rows }) {
  let added = 0, skipped = 0;
  for (const row of rows) {
    let word = {};
    if (grp === 'noun') {
      if (!row.tekil || !row.turkce) continue;
      word = { type: 'noun', word: row.tekil, plural: row.cogul || '', tr: row.turkce, level: row.seviye || 'A1.1', chapter: row.bolum || 'Andere' };
    } else if (grp === 'verb') {
      if (!row.mastar || !row.turkce) continue;
      word = { type: 'verb', word: row.mastar, tr: row.turkce, praesens: { ich: row.ich||'', du: row.du||'', er: row.er||'', wir: row.wir||'', ihr: row.ihr||'', sie: row.sie||'' },
        perfekt: row.perfekt||'', praeteritum: row.praeteritum||'', futur1: row.futur1||'', futur2: row.futur2||'', plusquam: row.plusquamperfekt||'',
        level: row.seviye || 'A1.1', chapter: row.bolum || 'Andere' };
    } else {
      if (!row.tur || !row.kelime || !row.turkce) continue;
      word = { type: row.tur === 'pron' ? 'pron' : 'adj', word: row.kelime, tr: row.turkce, extra: row.ekbilgi || '', level: row.seviye || 'A1.1', chapter: row.bolum || 'Andere' };
    }
    const result = await addWord({ userId, word });
    if (result.success) added++; else if (result.duplicate) skipped++;
  }
  return { success: true, added, skipped };
}

// ----------------------------------------------------------
// Master'dan önizleme
// ----------------------------------------------------------
async function masterPreview({ tur, seviye, bolum, programAdi }) {
  const pool = await getPool();
  const program = programAdi || 'Klett';
  let where = '1=1';
  const req = pool.request();
  req.input('program', sql.NVarChar(100), program);
  if (tur && tur !== 'all') { where += ' AND mw.Tur=@tur'; req.input('tur', sql.NVarChar(10), tur); }
  if (seviye && seviye !== 'all') { where += ' AND pc.Seviye=@seviye'; req.input('seviye', sql.NVarChar(10), seviye); }
  if (bolum && bolum !== 'all') { where += ' AND pc.Bolum=@bolum'; req.input('bolum', sql.NVarChar(50), bolum); }

  const result = await req.query(`
    SELECT COUNT(*) as toplam FROM MasterWords mw
    JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
    WHERE ${where}`);

  const seviyeler = await pool.request().input('program', sql.NVarChar(100), program)
    .query("SELECT DISTINCT Seviye FROM ProgramCurriculum WHERE ProgramAdi=@program AND Seviye IS NOT NULL ORDER BY Seviye");
  const bolumler = await pool.request().input('program', sql.NVarChar(100), program)
    .query("SELECT DISTINCT Bolum FROM ProgramCurriculum WHERE ProgramAdi=@program AND Bolum IS NOT NULL ORDER BY Bolum");

  return { success: true, toplam: result.recordset[0].toplam, seviyeler: seviyeler.recordset.map(r=>r.Seviye), bolumler: bolumler.recordset.map(r=>r.Bolum) };
}

// ----------------------------------------------------------
// Master'dan kullanıcı tablolarına aktar (referans ekleme)
// ----------------------------------------------------------
async function masterImport({ userId, tur, seviye, bolum, programAdi }) {
  const pool = await getPool();
  const program = programAdi || 'Klett';
  let where = '1=1';
  const req = pool.request();
  req.input('userId', sql.NVarChar(128), userId);
  req.input('program', sql.NVarChar(100), program);
  if (tur && tur !== 'all') { where += ' AND mw.Tur=@tur'; req.input('tur', sql.NVarChar(10), tur); }
  if (seviye && seviye !== 'all') { where += ' AND pc.Seviye=@seviye'; req.input('seviye', sql.NVarChar(10), seviye); }
  if (bolum && bolum !== 'all') { where += ' AND pc.Bolum=@bolum'; req.input('bolum', sql.NVarChar(50), bolum); }

  const masterWords = await req.query(`
    SELECT mw.Id, mw.Tur FROM MasterWords mw
    JOIN ProgramCurriculum pc ON pc.MasterWordId = mw.Id AND pc.ProgramAdi = @program
    WHERE ${where}`);

  let added = 0, skipped = 0;

  for (const w of masterWords.recordset) {
    const table = tableFor(w.Tur);
    const ex = await pool.request()
      .input('userId', sql.NVarChar(128), userId)
      .input('masterWordId', sql.Int, w.Id)
      .query(`SELECT Id FROM ${table} WHERE UserId=@userId AND MasterWordId=@masterWordId`);

    if (ex.recordset.length > 0) { skipped++; continue; }

    await pool.request()
      .input('userId', sql.NVarChar(128), userId)
      .input('masterWordId', sql.Int, w.Id)
      .input('program', sql.NVarChar(100), program)
      .query(`INSERT INTO ${table} (UserId, MasterWordId, ProgramAdi) VALUES (@userId, @masterWordId, @program)`);
    added++;
  }

  return { success: true, added, skipped, updated: 0 };
}

// ----------------------------------------------------------
// Çalışma Listeleri
// ----------------------------------------------------------
async function getLists({ userId }) {
  const pool = await getPool();
  const lists = await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .query('SELECT Id, ListName, OlusturmaTarihi FROM WordLists WHERE UserId=@userId ORDER BY OlusturmaTarihi DESC');
  for (const list of lists.recordset) {
    const cnt = await pool.request().input('listId', sql.Int, list.Id).query('SELECT COUNT(*) as cnt FROM WordListItems WHERE ListId=@listId');
    list.wordCount = cnt.recordset[0].cnt;
  }
  return { success: true, lists: lists.recordset };
}

async function saveList({ userId, listName }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('listName', sql.NVarChar(200), listName)
    .query('INSERT INTO WordLists (UserId, ListName) OUTPUT INSERTED.Id VALUES (@userId, @listName)');
  return { success: true, id: result.recordset[0].Id };
}

async function deleteList({ listId }) {
  const pool = await getPool();
  await pool.request().input('listId', sql.Int, listId).query('DELETE FROM WordLists WHERE Id=@listId');
  return { success: true };
}

async function addToList({ listId, wordId, wordCol }) {
  const pool = await getPool();
  try {
    await pool.request()
      .input('listId', sql.Int, listId)
      .input('wordId', sql.NVarChar(20), wordId)
      .input('wordCol', sql.NVarChar(20), wordCol)
      .query('INSERT INTO WordListItems (ListId, WordId, WordCol) VALUES (@listId, @wordId, @wordCol)');
  } catch (e) { /* zaten var */ }
  return { success: true };
}

async function removeFromList({ listId, wordId }) {
  const pool = await getPool();
  await pool.request().input('listId', sql.Int, listId).input('wordId', sql.NVarChar(20), wordId)
    .query('DELETE FROM WordListItems WHERE ListId=@listId AND WordId=@wordId');
  return { success: true };
}

async function getListWords({ listId }) {
  const pool = await getPool();
  const items = await pool.request().input('listId', sql.Int, listId).query('SELECT WordId, WordCol FROM WordListItems WHERE ListId=@listId');
  return { success: true, items: items.recordset };
}

// ----------------------------------------------------------
// Örnek cümleler
// ----------------------------------------------------------
async function getSentences({ almancaKelime, dil }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('kelime', sql.NVarChar(200), almancaKelime)
    .input('dil', sql.NVarChar(10), dil || 'tr')
    .query(`SELECT s.AlmancaCumle, s.CeviriCumle FROM Sentences s
            JOIN MasterWords mw ON mw.Id = s.MasterWordId
            WHERE LOWER(mw.AlmancaKelime) = LOWER(@kelime) AND s.Dil = @dil`);
  return { success: true, sentences: result.recordset };
}

// ----------------------------------------------------------
// Metinler (Okuma testi)
// ----------------------------------------------------------
async function getSentencesByProgram({ programAdi, bolum, seviye }) {
  const pool = await getPool();
  const program = programAdi || 'Klett';
  let where = 'ProgramAdi=@program';
  const req = pool.request().input('program', sql.NVarChar(100), program);
  if (seviye && seviye !== 'all') { where += ' AND Seviye=@seviye'; req.input('seviye', sql.NVarChar(10), seviye); }
  if (bolum && bolum !== 'all') { where += ' AND Bolum=@bolum'; req.input('bolum', sql.NVarChar(50), bolum); }
  const result = await req.query(`SELECT Id, AlmancaCumle, CeviriCumle, Bolum, Seviye, ProgramAdi
    FROM Sentences WHERE ${where} ORDER BY Bolum, Id`);
  return { success: true, sentences: result.recordset };
}

async function getTexts({ seviye, bolum, programAdi }) {
  const pool = await getPool();
  let where = '1=1';
  const req = pool.request();
  if (programAdi) { where += ' AND ProgramAdi=@program'; req.input('program', sql.NVarChar(100), programAdi); }
  if (seviye && seviye !== 'all') { where += ' AND Seviye=@seviye'; req.input('seviye', sql.NVarChar(10), seviye); }
  if (bolum && bolum !== 'all') { where += ' AND Bolum=@bolum'; req.input('bolum', sql.NVarChar(50), bolum); }
  const result = await req.query(`SELECT Id, Baslik, Seviye, Bolum FROM Texts WHERE ${where} ORDER BY Seviye, Bolum, Id`);
  return { success: true, texts: result.recordset };
}

async function getText({ id }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM Texts WHERE Id=@id');
  if (!result.recordset.length) return { success: false };
  return { success: true, text: result.recordset[0] };
}

// ----------------------------------------------------------
// Loglama
// ----------------------------------------------------------
async function logSession({ userId }) {
  const pool = await getPool();
  await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .query('INSERT INTO UserSessions (UserId) VALUES (@userId)');
  return { success: true };
}

async function logTest({ userId, testType, wordGroup, wordCount, correctCount }) {
  const pool = await getPool();
  const score = wordCount > 0 ? Math.round((correctCount / wordCount) * 100) : 0;
  await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('testType', sql.NVarChar(30), testType)
    .input('wordGroup', sql.NVarChar(10), wordGroup || '')
    .input('wordCount', sql.Int, wordCount || 0)
    .input('correctCount', sql.Int, correctCount || 0)
    .input('score', sql.Int, score)
    .query('INSERT INTO TestHistory (UserId, TestType, WordGroup, WordCount, CorrectCount, Score) VALUES (@userId, @testType, @wordGroup, @wordCount, @correctCount, @score)');
  return { success: true, score };
}

async function logAiUsage({ userId, action, inputTokens, outputTokens }) {
  const pool = await getPool();
  // Haiku fiyatlandırma: $0.80/1M input, $4.00/1M output
  const cost = (inputTokens * 0.0000008) + (outputTokens * 0.000004);
  await pool.request()
    .input('userId', sql.NVarChar(128), userId)
    .input('action', sql.NVarChar(50), action)
    .input('inputTokens', sql.Int, inputTokens || 0)
    .input('outputTokens', sql.Int, outputTokens || 0)
    .input('cost', sql.Decimal(10, 6), cost)
    .query('INSERT INTO AiUsage (UserId, Action, InputTokens, OutputTokens, CostUsd) VALUES (@userId, @action, @inputTokens, @outputTokens, @cost)');
  return { success: true, cost };
}

// ----------------------------------------------------------
// Kullanıcı raporu
// ----------------------------------------------------------
async function getUserReport({ userId, anaAil }) {
  const pool = await getPool();
  const dil = anaAil || 'tr';

  const [sessions, tests, nomen, verben, adjektiv, aiUsage] = await Promise.all([
    // Login sayısı
    pool.request().input('userId', sql.NVarChar(128), userId)
      .query('SELECT COUNT(*) as cnt, MIN(LoginTime) as firstLogin, MAX(LoginTime) as lastLogin FROM UserSessions WHERE UserId=@userId'),
    // Test istatistikleri
    pool.request().input('userId', sql.NVarChar(128), userId)
      .query(`SELECT TestType, WordGroup, COUNT(*) as testCount, AVG(Score) as avgScore, SUM(WordCount) as totalWords, SUM(CorrectCount) as totalCorrect
              FROM TestHistory WHERE UserId=@userId GROUP BY TestType, WordGroup ORDER BY TestType`),
    // En iyi/kötü Nomen
    pool.request().input('userId', sql.NVarChar(128), userId).input('dil', sql.NVarChar(10), dil)
      .query(`SELECT TOP 5 mw.AlmancaKelime as word, mt.Ceviri as tr, n.Correct, n.Wrong, n.Streak,
              CASE WHEN (n.Correct+n.Wrong)=0 THEN 0 ELSE CAST((n.Correct-n.Wrong)*100.0/(n.Correct+n.Wrong) AS INT) END as rate
              FROM Nomen n JOIN MasterWords mw ON mw.Id=n.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId=mw.Id AND mt.Dil=@dil
              WHERE n.UserId=@userId AND (n.Correct+n.Wrong)>0 ORDER BY CASE WHEN (n.Correct+n.Wrong)=0 THEN 0 ELSE CAST((n.Correct-n.Wrong)*100.0/(n.Correct+n.Wrong) AS INT) END DESC`),
    pool.request().input('userId', sql.NVarChar(128), userId).input('dil', sql.NVarChar(10), dil)
      .query(`SELECT TOP 5 mw.AlmancaKelime as word, mt.Ceviri as tr, v.Correct, v.Wrong, v.Streak,
              CASE WHEN (v.Correct+v.Wrong)=0 THEN 0 ELSE CAST((v.Correct-v.Wrong)*100.0/(v.Correct+v.Wrong) AS INT) END as rate
              FROM Verben v JOIN MasterWords mw ON mw.Id=v.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId=mw.Id AND mt.Dil=@dil
              WHERE v.UserId=@userId AND (v.Correct+v.Wrong)>0 ORDER BY CASE WHEN (v.Correct+v.Wrong)=0 THEN 0 ELSE CAST((v.Correct-v.Wrong)*100.0/(v.Correct+v.Wrong) AS INT) END DESC`),
    pool.request().input('userId', sql.NVarChar(128), userId).input('dil', sql.NVarChar(10), dil)
      .query(`SELECT TOP 5 mw.AlmancaKelime as word, mt.Ceviri as tr, a.Correct, a.Wrong, a.Streak,
              CASE WHEN (a.Correct+a.Wrong)=0 THEN 0 ELSE CAST((a.Correct-a.Wrong)*100.0/(a.Correct+a.Wrong) AS INT) END as rate
              FROM Adjektiv a JOIN MasterWords mw ON mw.Id=a.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId=mw.Id AND mt.Dil=@dil
              WHERE a.UserId=@userId AND (a.Correct+a.Wrong)>0 ORDER BY CASE WHEN (a.Correct+a.Wrong)=0 THEN 0 ELSE CAST((a.Correct-a.Wrong)*100.0/(a.Correct+a.Wrong) AS INT) END DESC`),
    // AI kullanım
    pool.request().input('userId', sql.NVarChar(128), userId)
      .query('SELECT SUM(InputTokens) as totalInput, SUM(OutputTokens) as totalOutput, SUM(CostUsd) as totalCost FROM AiUsage WHERE UserId=@userId')
  ]);

  // En kötü kelimeler (ayrı sorgular)
  const [worstNomen, worstVerben, worstAdjektiv] = await Promise.all([
    pool.request().input('userId', sql.NVarChar(128), userId).input('dil', sql.NVarChar(10), dil)
      .query(`SELECT TOP 5 mw.AlmancaKelime as word, mt.Ceviri as tr, n.Correct, n.Wrong,
              CASE WHEN (n.Correct+n.Wrong)=0 THEN 0 ELSE CAST((n.Correct-n.Wrong)*100.0/(n.Correct+n.Wrong) AS INT) END as rate
              FROM Nomen n JOIN MasterWords mw ON mw.Id=n.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId=mw.Id AND mt.Dil=@dil
              WHERE n.UserId=@userId AND (n.Correct+n.Wrong)>0 ORDER BY CASE WHEN (n.Correct+n.Wrong)=0 THEN 0 ELSE CAST((n.Correct-n.Wrong)*100.0/(n.Correct+n.Wrong) AS INT) END ASC`),
    pool.request().input('userId', sql.NVarChar(128), userId).input('dil', sql.NVarChar(10), dil)
      .query(`SELECT TOP 5 mw.AlmancaKelime as word, mt.Ceviri as tr, v.Correct, v.Wrong,
              CASE WHEN (v.Correct+v.Wrong)=0 THEN 0 ELSE CAST((v.Correct-v.Wrong)*100.0/(v.Correct+v.Wrong) AS INT) END as rate
              FROM Verben v JOIN MasterWords mw ON mw.Id=v.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId=mw.Id AND mt.Dil=@dil
              WHERE v.UserId=@userId AND (v.Correct+v.Wrong)>0 ORDER BY CASE WHEN (v.Correct+v.Wrong)=0 THEN 0 ELSE CAST((v.Correct-v.Wrong)*100.0/(v.Correct+v.Wrong) AS INT) END ASC`),
    pool.request().input('userId', sql.NVarChar(128), userId).input('dil', sql.NVarChar(10), dil)
      .query(`SELECT TOP 5 mw.AlmancaKelime as word, mt.Ceviri as tr, a.Correct, a.Wrong,
              CASE WHEN (a.Correct+a.Wrong)=0 THEN 0 ELSE CAST((a.Correct-a.Wrong)*100.0/(a.Correct+a.Wrong) AS INT) END as rate
              FROM Adjektiv a JOIN MasterWords mw ON mw.Id=a.MasterWordId
              LEFT JOIN MasterTranslations mt ON mt.MasterWordId=mw.Id AND mt.Dil=@dil
              WHERE a.UserId=@userId AND (a.Correct+a.Wrong)>0 ORDER BY CASE WHEN (a.Correct+a.Wrong)=0 THEN 0 ELSE CAST((a.Correct-a.Wrong)*100.0/(a.Correct+a.Wrong) AS INT) END ASC`)
  ]);

  return {
    success: true,
    sessions: sessions.recordset[0],
    tests: tests.recordset,
    best: { nomen: nomen.recordset, verben: verben.recordset, adjektiv: adjektiv.recordset },
    worst: { nomen: worstNomen.recordset, verben: worstVerben.recordset, adjektiv: worstAdjektiv.recordset },
    aiUsage: aiUsage.recordset[0]
  };
}

// ----------------------------------------------------------
// Admin raporu (KullaniciTipi >= 4)
// ----------------------------------------------------------
async function getAdminReport({ userId }) {
  const pool = await getPool();

  // Yetkili mi?
  const auth = await pool.request().input('userId', sql.NVarChar(128), userId)
    .query('SELECT KullaniciTipi FROM Users WHERE UserId=@userId');
  if (!auth.recordset.length || auth.recordset[0].KullaniciTipi < 4) {
    return { success: false, error: 'Yetkisiz erişim' };
  }

  const [users, testStats, aiStats, loginStats] = await Promise.all([
    // Kullanıcı listesi
    pool.request().query(`
      SELECT u.UserId, u.Email, u.AnaDil, u.KullaniciTipi, u.ProgramAdi,
        (SELECT COUNT(*) FROM Nomen WHERE UserId=u.UserId) +
        (SELECT COUNT(*) FROM Verben WHERE UserId=u.UserId) +
        (SELECT COUNT(*) FROM Adjektiv WHERE UserId=u.UserId) as wordCount,
        (SELECT COUNT(*) FROM UserSessions WHERE UserId=u.UserId) as loginCount,
        (SELECT MAX(LoginTime) FROM UserSessions WHERE UserId=u.UserId) as lastLogin
      FROM Users u ORDER BY loginCount DESC`),
    // Test istatistikleri kullanıcı bazlı
    pool.request().query(`
      SELECT UserId, COUNT(*) as testCount, AVG(Score) as avgScore,
             SUM(WordCount) as totalWords, SUM(CorrectCount) as totalCorrect
      FROM TestHistory GROUP BY UserId`),
    // AI kullanım kullanıcı bazlı
    pool.request().query(`
      SELECT UserId, COUNT(*) as queryCount,
             SUM(InputTokens) as totalInput, SUM(OutputTokens) as totalOutput,
             SUM(CostUsd) as totalCost
      FROM AiUsage GROUP BY UserId`),
    // Son 30 gün günlük login sayısı
    pool.request().query(`
      SELECT CAST(LoginTime AS DATE) as day, COUNT(*) as cnt
      FROM UserSessions WHERE LoginTime >= DATEADD(DAY,-30,GETUTCDATE())
      GROUP BY CAST(LoginTime AS DATE) ORDER BY day`)
  ]);

  // Toplam AI maliyeti
  const totalAi = await pool.request().query('SELECT SUM(CostUsd) as total FROM AiUsage');

  return {
    success: true,
    users: users.recordset,
    testStats: testStats.recordset,
    aiStats: aiStats.recordset,
    loginStats: loginStats.recordset,
    totalAiCost: totalAi.recordset[0].total || 0
  };
}