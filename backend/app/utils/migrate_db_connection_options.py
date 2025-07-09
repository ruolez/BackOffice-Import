#!/usr/bin/env python3
"""
Migration script to add connection security options to existing database configs
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app import app, db
from app.models import DatabaseConfig
from sqlalchemy import Column, Boolean, String
from sqlalchemy.exc import OperationalError
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def add_connection_security_columns():
    """Add new columns for connection security options"""
    with app.app_context():
        try:
            # Try to add columns using raw SQL
            with db.engine.connect() as conn:
                # Check if columns already exist
                result = conn.execute(
                    "PRAGMA table_info(database_configs)"
                )
                columns = [row[1] for row in result]
                
                # Add encrypt_connection column if it doesn't exist
                if 'encrypt_connection' not in columns:
                    conn.execute(
                        "ALTER TABLE database_configs ADD COLUMN encrypt_connection BOOLEAN DEFAULT 1"
                    )
                    conn.commit()
                    logger.info("Added encrypt_connection column")
                else:
                    logger.info("encrypt_connection column already exists")
                
                # Add trust_server_certificate column if it doesn't exist
                if 'trust_server_certificate' not in columns:
                    conn.execute(
                        "ALTER TABLE database_configs ADD COLUMN trust_server_certificate BOOLEAN DEFAULT 1"
                    )
                    conn.commit()
                    logger.info("Added trust_server_certificate column")
                else:
                    logger.info("trust_server_certificate column already exists")
                
                # Add tls_min_protocol column if it doesn't exist
                if 'tls_min_protocol' not in columns:
                    conn.execute(
                        "ALTER TABLE database_configs ADD COLUMN tls_min_protocol VARCHAR(20)"
                    )
                    conn.commit()
                    logger.info("Added tls_min_protocol column")
                else:
                    logger.info("tls_min_protocol column already exists")
                
                logger.info("Migration completed successfully")
                
        except Exception as e:
            logger.error(f"Migration failed: {e}")
            raise

if __name__ == "__main__":
    logger.info("Starting connection security options migration...")
    add_connection_security_columns()
    logger.info("Migration complete!")