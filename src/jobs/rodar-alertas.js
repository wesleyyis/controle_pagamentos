'use strict';

// Execução manual da verificação de alertas: npm run alertas
require('dotenv').config();

const { pool } = require('../../db');
const { executar } = require('./alertas');
executar()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
