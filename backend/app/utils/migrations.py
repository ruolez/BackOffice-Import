"""Database migrations for BackOffice Invoice System"""

from app.models import db, DatabaseConfig
import logging

logger = logging.getLogger(__name__)

def run_migrations():
    """Run all pending migrations"""
    try:
        print("Running database migrations...")
        # Migration 1: Update ODBC Driver 17 to Driver 18
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