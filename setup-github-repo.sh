#!/bin/bash

# GitHub Repository Setup Script for BackOffice Invoice System

echo "======================================"
echo "GitHub Repository Setup"
echo "======================================"
echo ""
echo "This script will help you set up your GitHub repository."
echo ""

# Check if git is initialized
if [ ! -d .git ]; then
    echo "Initializing git repository..."
    git init
fi

# Add all files
echo "Adding files to git..."
git add .

# Create initial commit
echo "Creating initial commit..."
git commit -m "Initial commit: BackOffice Invoice Import System

- Flask backend with SQLAlchemy ORM
- Multi-database SQL Server support
- Excel file processing for invoice creation
- User authentication and database configuration management
- Docker containerization for easy deployment
- Production-ready installation script
- Comprehensive documentation

Features:
- Import Excel files with UPC, Cost, QTY columns
- Join with SQL Server Items_tbl via UPC
- Create invoices in Invoices_tbl and InvoicesDetails_tbl
- Support for multiple database connections
- Secure user authentication
- Modern Bootstrap 5 UI"

echo ""
echo "======================================"
echo "Manual Steps Required:"
echo "======================================"
echo ""
echo "1. Create a new repository on GitHub:"
echo "   - Go to https://github.com/new"
echo "   - Repository name: BackOffice-Invoice-Import"
echo "   - Description: A modern web application for creating invoices from Excel files by joining data with external SQL Server databases"
echo "   - Make it Public or Private as desired"
echo "   - DO NOT initialize with README, .gitignore, or license"
echo ""
echo "2. After creating the repository, run these commands:"
echo ""
echo "   git remote add origin https://github.com/YOUR_USERNAME/BackOffice-Invoice-Import.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""
echo "Replace YOUR_USERNAME with your GitHub username."
echo ""
echo "3. Optional: Set up GitHub Pages for documentation:"
echo "   - Go to Settings > Pages in your repository"
echo "   - Select 'Deploy from a branch'"
echo "   - Choose 'main' branch and '/ (root)' folder"
echo ""

# Show current git status
echo "Current git status:"
echo "=================="
git status --short

echo ""
echo "Repository is ready to be pushed to GitHub!"