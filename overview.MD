## initial instructions
I want you to start a new development instance with html css javascript and python with a login system, using sqlite as the database, use docker to create the dev instance so you can easily check logs - i need to be able create an account and then login on a login page - create a good looking modern UI, find a good library that can provide a beautiful responsive design for an interactive user experience. make it slick and good looking! Create tests along the way to test functionality as you implement it and check logs of docker containers to make sure everything is running properly. please use MCP servers to do research and feel free to use pupiteer mcp to browse and check the web page.


## Here are basic instructions for how we will create a new Invoice in the SQL database.

Here is the flow of the user experience in our new application. First, the user will configure SQL databases and will save their configuration in our local SQLite database. Once the connection to the database has been successfully established, we save that entry. Next, the user goes to create a new invoice. They choose the database to work with. And then they upload an Excel file. That Excel file will have three fields. UPC, Cost, and Quantity, which will be abbreviated as QTY. Our system will take this Excel file, find the products by UPC in our items table that is specified with schema below. And it will construct a new invoice using the tables invoices table and invoices details table. You will find all item attributes in the items table. So you will need to join using the UPC to find all the details that are needed to construct a new invoice. Using invoices table and invoices details table.

Let's keep in mind that the invoice number is going to be incrementally increased by one from the last invoice number in the database. Invoice ID gets generated automatically by the SQL Server. InvoiceDetails and Invoices table are linked together by Invoice ID.

Once our system processes the Excel file and is ready to save the new invoice, it will tell the user that it is ready to do so and once the user confirms it, we are going to create that new invoice.

We should also handle errors gracefully. We should make sure that the UPC that is included in the Excel file can be found in the items table of the database we are working with. If the UPC barcode cannot be found, the user should get a list of UPC barcodes that the system could not find before saving that invoice.

## Tech Stack
	BackEnd		Python 
	Frontend	HTML/CSS/JavaScript
	database	SQLite3

## SQL Tables and their Schema

## Invoices_tbl

/****** Object:  Table [dbo].[Invoices_tbl]    Script Date: 7/8/2025 2:04:46 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Invoices_tbl](
	[InvoiceID] [int] IDENTITY(1,1) NOT FOR REPLICATION NOT NULL,
	[InvoiceNumber] [nvarchar](20) NULL,
	[InvoiceDate] [smalldatetime] NULL,
	[InvoiceType] [nvarchar](50) NULL,
	[InvoiceTitle] [nvarchar](50) NULL,
	[CustomerID] [int] NULL,
	[BusinessName] [nvarchar](50) NULL,
	[AccountNo] [nvarchar](13) NULL,
	[PoNumber] [nvarchar](20) NULL,
	[ShipDate] [smalldatetime] NULL,
	[Shipto] [nvarchar](50) NULL,
	[ShipAddress1] [nvarchar](50) NULL,
	[ShipAddress2] [nvarchar](50) NULL,
	[ShipContact] [nvarchar](50) NULL,
	[ShipCity] [nvarchar](20) NULL,
	[ShipState] [nvarchar](3) NULL,
	[ShipZipCode] [nvarchar](10) NULL,
	[ShipPhoneNo] [nvarchar](13) NULL,
	[DriverID] [int] NULL,
	[TermID] [int] NULL,
	[SalesRepID] [int] NULL,
	[ShipperID] [int] NULL,
	[TrackingNo] [nvarchar](50) NULL,
	[ShippingCost] [money] NULL,
	[TotQtyOrd] [int] NULL,
	[TotQtyShp] [int] NULL,
	[TotQtyRtrnd] [int] NULL,
	[NoLines] [int] NULL,
	[NoBoxes] [smallint] NULL,
	[TotalWeight] [real] NULL,
	[TotalDiscounts] [money] NULL,
	[InvoiceSubtotal] [money] NULL,
	[TotalTaxes] [money] NULL,
	[OtherCharges] [money] NULL,
	[InvoiceTotal] [money] NULL,
	[TotalCredits] [money] NULL,
	[TotalPayments] [money] NULL,
	[OrderPrinted] [bit] NULL,
	[InvoicePrinted] [bit] NULL,
	[PackingSlipPrinted] [bit] NULL,
	[PickListPrinted] [bit] NULL,
	[Imported] [bit] NULL,
	[Pos] [bit] NULL,
	[Notes] [nvarchar](255) NULL,
	[Header] [nvarchar](255) NULL,
	[Footer] [nvarchar](255) NULL,
	[Void] [bit] NULL,
 CONSTRAINT [PK_Invoices] PRIMARY KEY CLUSTERED 
(
	[InvoiceID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

## InvoicesDetails_tbl

/****** Object:  Table [dbo].[InvoicesDetails_tbl]    Script Date: 7/8/2025 2:05:59 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[InvoicesDetails_tbl](
	[LineID] [int] IDENTITY(1,1) NOT FOR REPLICATION NOT NULL,
	[InvoiceID] [int] NULL,
	[CateID] [int] NULL,
	[SubCateID] [int] NULL,
	[UnitDesc] [nvarchar](50) NULL,
	[UnitQty] [real] NULL,
	[ProductID] [int] NULL,
	[ProductSKU] [nvarchar](20) NULL,
	[ProductUPC] [nvarchar](20) NULL,
	[ProductDescription] [nvarchar](50) NULL,
	[ItemSize] [nvarchar](10) NULL,
	[LineMessage] [nvarchar](96) NULL,
	[UnitPrice] [money] NULL,
	[OriginalPrice] [money] NULL,
	[RememberPrice] [bit] NULL,
	[UnitCost] [money] NULL,
	[Discount] [real] NULL,
	[ds_Percent] [bit] NULL,
	[QtyShipped] [real] NULL,
	[QtyOrdered] [real] NULL,
	[ItemWeight] [nvarchar](10) NULL,
	[Packing] [nvarchar](255) NULL,
	[ExtendedPrice] [money] NULL,
	[ExtendedDisc] [money] NULL,
	[ExtendedCost] [money] NULL,
	[PromotionID] [int] NULL,
	[PromotionLine] [bit] NULL,
	[PromotionDescription] [nvarchar](50) NULL,
	[PromotionAmount] [money] NULL,
	[ActExtendedPrice] [money] NULL,
	[SPPromoted] [bit] NULL,
	[SPPromotionDescription] [nvarchar](50) NULL,
	[Taxable] [bit] NULL,
	[ItemTaxID] [int] NULL,
	[Catch] [int] NULL,
	[Negative] [bit] NULL,
	[Flag] [bit] NULL,
	[Void] [bit] NULL,
 CONSTRAINT [PK_InvoicesDetails_tbl] PRIMARY KEY CLUSTERED 
(
	[LineID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

## Items_tbl

/****** Object:  Table [dbo].[Items_tbl]    Script Date: 7/8/2025 2:06:36 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Items_tbl](
	[ProductID] [int] IDENTITY(1000,10) NOT FOR REPLICATION NOT NULL,
	[CateID] [int] NULL,
	[SubCateID] [int] NULL,
	[ProductSKU] [nvarchar](20) NULL,
	[ProductUPC] [nvarchar](20) NULL,
	[ProductDescription] [nvarchar](50) NULL,
	[ExtDescription] [ntext] NULL,
	[ProductType] [smallint] NULL,
	[ValuationMethod] [smallint] NULL,
	[ItemTaxID] [int] NULL,
	[UnitPrice] [money] NULL,
	[UnitPriceA] [money] NULL,
	[UnitPriceB] [money] NULL,
	[UnitPriceC] [money] NULL,
	[MSRPrice] [money] NULL,
	[AvrCost] [money] NULL,
	[LastCost] [money] NULL,
	[UnitCost] [money] NULL,
	[LastReceived] [smalldatetime] NULL,
	[LastSold] [smalldatetime] NULL,
	[ReorderLevel] [int] NULL,
	[ReorderQuant] [int] NULL,
	[QuantOnHand] [real] NULL,
	[QuantOnOrder] [real] NULL,
	[PromotionID] [int] NULL,
	[ManuID] [int] NULL,
	[ManuProductID] [nvarchar](20) NULL,
	[SPPromoted] [bit] NOT NULL,
	[SPPromotionDescription] [nvarchar](50) NULL,
	[SPPromotionCode] [nvarchar](20) NULL,
	[StLocationID] [int] NULL,
	[Discontinued] [bit] NULL,
	[UnitID] [int] NULL,
	[UnitID2] [int] NULL,
	[UnitID3] [int] NULL,
	[UnitID4] [int] NULL,
	[UnitQty2] [real] NULL,
	[UnitQty3] [real] NULL,
	[UnitQty4] [real] NULL,
	[UnitPrice2] [money] NULL,
	[UnitPriceA2] [money] NULL,
	[UnitPriceB2] [money] NULL,
	[UnitPriceC2] [money] NULL,
	[UnitPrice3] [money] NULL,
	[UnitPriceA3] [money] NULL,
	[UnitPriceB3] [money] NULL,
	[UnitPriceC3] [money] NULL,
	[UnitPrice4] [money] NULL,
	[UnitPriceA4] [money] NULL,
	[UnitPriceB4] [money] NULL,
	[UnitPriceC4] [money] NULL,
	[CountInUnit] [smallint] NULL,
	[ItemSize] [nvarchar](10) NULL,
	[ItemWeight] [nvarchar](10) NULL,
	[LastCountDate] [smalldatetime] NULL,
	[BarcodeFormat] [smallint] NULL,
	[ExpDate] [smalldatetime] NULL,
	[ProductMessage] [nvarchar](96) NULL,
	[Notes] [nvarchar](500) NULL,
 CONSTRAINT [PK_Items_tbl] PRIMARY KEY CLUSTERED 
(
	[ProductID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

Please analyze the database tables schema in detail and make sure you understand how to properly construct the new invoice using these three tables that I have provided to you. If you have any questions or concerns or confusions, please do not hesitate to ask me. Thank you.
 