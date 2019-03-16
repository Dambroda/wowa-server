import Express from 'express';
import Sequelize from 'sequelize';
import Raven from 'raven';

import BlizzardCommunityApi from 'helpers/BlizzardCommunityApi';

import models from '../../models';

const Spell = models.Spell;

/**
 * Fetches Spell info(name and icon) from the battle net API.
 * After fetching from API it'll store in MySQL DB in order to reduce the number of calls to the battle net API
 * and reduce latency on subsequent calls
 */

function sendJson(res, json) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(json);
}
function send404(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendStatus(404);
}

async function proxySpellApi(res, spellId) {
  try {
    const response = await BlizzardCommunityApi.fetchSpell(spellId);
    const json = JSON.parse(response);
    sendJson(res, json);
    return json;
  } catch (error) {
    const { statusCode, message, response } = error;
    console.log('REQUEST', 'Error fetching Spell', statusCode, message);
    const body = response ? response.body : null;
    // Ignore 404 - Spell not found errors. We check for the text so this doesn't silently break when the API endpoint changes.
    // Example body of good 404:
    // {
    //   "status": "nok",
    //   "reason": "unable to get spell information."
    // }
    const isSpellNotFoundError = statusCode === 404 && body && body.includes('unable to get spell information.');
    if (isSpellNotFoundError) {
      send404(res);
    } else {
      Raven.installed && Raven.captureException(error);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.status(statusCode || 500);
      sendJson(res, {
        error: 'Blizzard API error',
        message: body || error.message,
      });
    }
    return null;
  }
}
async function storeSpell({ id, name, icon }) {
  await Spell.upsert({
    id,
    name,
    icon,
    lastSeenAt: Sequelize.fn('NOW'),
  });
}

const router = Express.Router();
router.get('/i/spell/:id([0-9]+)', async (req, res) => {
  const { id } = req.params;
  let spell = await Spell.findByPk(id);
  if (spell) {
    sendJson(res, spell);
    spell.update({
      lastSeenAt: Sequelize.fn('NOW'),
    });
  } else {
    spell = await proxySpellApi(res, id);
    if (spell) {
      storeSpell(spell);
    }
  }
});
export default router;