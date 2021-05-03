"""Seed the test.rdb.sqlite3 DB file.

This DB file contains the 'recording' for the test.py file."""

from sampleWorkspace.goet_tracer import Tracer
import sqlite3
from pathlib import Path

DB_FILE = Path('test.rdb.sqlite3')

if DB_FILE.exists():
    DB_FILE.unlink()
DB_FILE.touch()

connection = sqlite3.connect('test.rdb.sqlite3')
cursor = connection.cursor()

# snapshot consists of all the frames + all the variables
sql = '''
CREATE TABLE lines (
    id INTEGER PRIMARY KEY,
    snapshot BLOB,
);
'''

cursor.execute(sql)

with Tracer.trace_manager() as t:
    from . import test


cursor.close()
connection.close()
