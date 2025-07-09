"""Database migrations for BackOffice Invoice System"""

from app.models import db, DatabaseConfig
from sqlalchemy import text
import logging

logger = logging.getLogger(__name__)

def run_migrations():
    """Run all pending migrations"""
    try:
        print("Running database migrations...")
        # Migration 1: Add connection security columns (must be done first)
        add_connection_security_columns()
        # Migration 2: Update ODBC Driver 17 to Driver 18
        migrate_odbc_driver_v17_to_v18()
        print("All migrations completed")
        
    except Exception as e:
        print(f"Migration failed: {e}")
        logger.error(f"Migration failed: {e}")

def migrate_odbc_driver_v17_to_v18():
    """Update all database configs using ODBC Driver 17 to use Driver 18"""
    try:
        # Find all configs using the old driver
        old_driver = 'ODBC Driver 17 for SQL Server'
        new_driver = 'ODBC Driver 18 for SQL Server'
        
        configs_to_update = DatabaseConfig.query.filter_by(driver=old_driver).all()
        
        if configs_to_update:
            print(f"Updating {len(configs_to_update)} database configs from Driver 17 to Driver 18")
            logger.info(f"Updating {len(configs_to_update)} database configs from Driver 17 to Driver 18")
            
            for config in configs_to_update:
                config.driver = new_driver
                print(f"Updated config '{config.name}' to use {new_driver}")
                logger.info(f"Updated config '{config.name}' to use {new_driver}")
            
            db.session.commit()
            print("Driver migration completed successfully")
            logger.info("Migration completed successfully")
        else:
            print("No database configs need driver migration")
            logger.info("No database configs need driver migration")
            
    except Exception as e:
        db.session.rollback()
        logger.error(f"Failed to migrate ODBC drivers: {e}")
        raise e

def add_connection_security_columns():
    """Add connection security columns to database_configs table"""
    try:
        # Check if columns already exist by querying table info
        with db.engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(database_configs)"))
            columns = [row[1] for row in result]
            
            columns_added = False
            
            # Add encrypt_connection column if it doesn't exist
            if 'encrypt_connection' not in columns:
                conn.execute(text(
                    "ALTER TABLE database_configs ADD COLUMN encrypt_connection BOOLEAN DEFAULT 1"
                ))
                conn.commit()
                print("Added encrypt_connection column")
                logger.info("Added encrypt_connection column")
                columns_added = True
            
            # Add trust_server_certificate column if it doesn't exist
            if 'trust_server_certificate' not in columns:
                conn.execute(text(
                    "ALTER TABLE database_configs ADD COLUMN trust_server_certificate BOOLEAN DEFAULT 1"
                ))
                conn.commit()
                print("Added trust_server_certificate column")
                logger.info("Added trust_server_certificate column")
                columns_added = True
            
            # Add tls_min_protocol column if it doesn't exist
            if 'tls_min_protocol' not in columns:
                conn.execute(text(
                    "ALTER TABLE database_configs ADD COLUMN tls_min_protocol VARCHAR(20)"
                ))
                conn.commit()
                print("Added tls_min_protocol column")
                logger.info("Added tls_min_protocol column")
                columns_added = True
            
            if not columns_added:
                print("Connection security columns already exist")
                logger.info("Connection security columns already exist")
            
    except Exception as e:
        logger.error(f"Failed to add connection security columns: {e}")
        raise e