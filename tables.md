/****** Object:  Table [dbo].[Customers_tbl]    Script Date: 7/8/2025 5:13:16 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Customers_tbl](
	[CustomerID] [int] IDENTITY(1,1) NOT NULL,
	[AccountNo] [nvarchar](13) NULL,
	[BusinessName] [nvarchar](50) NULL,
	[Location_Number] [nvarchar](8) NULL,
	[Address1] [nvarchar](32) NULL,
	[Address2] [nvarchar](32) NULL,
	[City] [nvarchar](24) NULL,
	[State] [nvarchar](3) NULL,
	[ZipCode] [nvarchar](10) NULL,
	[Phone_Number] [nvarchar](13) NULL,
	[Fax_Number] [nvarchar](13) NULL,
	[Contactname] [nvarchar](50) NULL,
	[ShipCustomerID] [int] NULL,
	[ShipTo] [nvarchar](50) NULL,
	[ShipContact] [nvarchar](32) NULL,
	[ShipAddress1] [nvarchar](32) NULL,
	[ShipAddress2] [nvarchar](32) NULL,
	[ShipCity] [nvarchar](24) NULL,
	[ShipState] [nvarchar](3) NULL,
	[ShipZipCode] [nvarchar](10) NULL,
	[ShipPhone_Number] [nvarchar](13) NULL,
	[Notes] [nvarchar](255) NULL,
	[AcctType] [int] NULL,
	[PriceLevel] [nvarchar](1) NULL,
	[TaxDefID] [int] NULL,
	[S_S_NorE_I_N] [nvarchar](50) NULL,
	[Category] [int] NULL,
	[StateTaxID] [nvarchar](24) NULL,
	[StateTaxRegExp] [smalldatetime] NULL,
	[Owner_Name] [nvarchar](50) NULL,
	[Owner_Address1] [nvarchar](60) NULL,
	[Owner_Address2] [nvarchar](50) NULL,
	[Owner_City] [nvarchar](24) NULL,
	[Owner_State] [nvarchar](3) NULL,
	[Owner_ZipCode] [nvarchar](10) NULL,
	[Owner_Phone_Number] [nvarchar](13) NULL,
	[Owner_FaxNumber] [nvarchar](13) NULL,
	[CustomerSince] [smalldatetime] NULL,
	[CreditLimit] [money] NULL,
	[Balance] [money] NULL,
	[day_order] [int] NULL,
	[day_deliv] [int] NULL,
	[TermID] [int] NULL,
	[SalesRepID] [int] NULL,
	[RouteID] [int] NULL,
	[Discontinued] [bit] NULL,
	[Memo] [ntext] NULL,
	[flaged] [bit] NULL,
 CONSTRAINT [PK_Customers] PRIMARY KEY CLUSTERED 
(
	[CustomerID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO



/****** Object:  Table [dbo].[PaymentMethods_tbl]    Script Date: 7/8/2025 5:46:51 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[PaymentMethods_tbl](
	[method_id] [int] IDENTITY(1,1) NOT NULL,
	[method] [nvarchar](50) NULL,
 CONSTRAINT [PK_PymntMethods] PRIMARY KEY CLUSTERED 
(
	[method_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO


/****** Object:  Table [dbo].[Routes_tbl]    Script Date: 7/8/2025 5:47:26 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Routes_tbl](
	[RouteID] [int] IDENTITY(1,1) NOT NULL,
	[Route_Name] [nvarchar](50) NULL,
 CONSTRAINT [PK_Routes] PRIMARY KEY CLUSTERED 
(
	[RouteID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

/****** Object:  Table [dbo].[Shippers_tbl]    Script Date: 7/8/2025 5:47:49 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Shippers_tbl](
	[ShipperID] [int] IDENTITY(1,1) NOT NULL,
	[Shipper] [nvarchar](50) NULL,
 CONSTRAINT [PK_Shippers_tbl] PRIMARY KEY CLUSTERED 
(
	[ShipperID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO


/****** Object:  Table [dbo].[Terms_tbl]    Script Date: 7/8/2025 5:48:12 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Terms_tbl](
	[TermID] [int] IDENTITY(1,1) NOT NULL,
	[TermDescription] [nvarchar](50) NULL,
 CONSTRAINT [PK_Terms] PRIMARY KEY CLUSTERED 
(
	[TermID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO


/****** Object:  Table [dbo].[PurchaseOrders_tbl]    Script Date: 7/9/2025 6:22:52 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[PurchaseOrders_tbl](
	[PoID] [int] IDENTITY(1,1) NOT NULL,
	[PoDate] [smalldatetime] NULL,
	[RequiredDate] [smalldatetime] NULL,
	[PoNumber] [nvarchar](20) NULL,
	[SupplierID] [int] NULL,
	[BusinessName] [nvarchar](50) NULL,
	[AccountNo] [nvarchar](13) NULL,
	[PoTitle] [nvarchar](50) NULL,
	[Status] [smallint] NULL,
	[Shipto] [nvarchar](50) NULL,
	[ShipAddress1] [nvarchar](50) NULL,
	[ShipAddress2] [nvarchar](50) NULL,
	[ShipContact] [nvarchar](50) NULL,
	[ShipCity] [nvarchar](24) NULL,
	[ShipState] [nvarchar](3) NULL,
	[ShipZipCode] [nvarchar](10) NULL,
	[ShipPhoneNo] [nvarchar](13) NULL,
	[EmployeeID] [int] NULL,
	[TermID] [int] NULL,
	[PoTotal] [money] NULL,
	[NoLines] [int] NULL,
	[ShipperID] [int] NULL,
	[TotQtyOrd] [real] NULL,
	[TotQtyRcv] [real] NULL,
	[Notes] [ntext] NULL,
	[PoHeader] [nvarchar](1000) NULL,
	[PoFooter] [nvarchar](1000) NULL,
 CONSTRAINT [PK_PurchaseOrders] PRIMARY KEY CLUSTERED 
(
	[PoID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO

/****** Object:  Table [dbo].[PurchaseOrdersDetails_tbl]    Script Date: 7/9/2025 6:24:04 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[PurchaseOrdersDetails_tbl](
	[LineID] [int] IDENTITY(1,1) NOT NULL,
	[PoID] [int] NOT NULL,
	[ProductID] [int] NULL,
	[CateID] [int] NULL,
	[SubCateID] [int] NULL,
	[UnitDesc] [nvarchar](50) NULL,
	[UnitQty] [real] NULL,
	[ProductSKU] [nvarchar](20) NULL,
	[ProductUPC] [nvarchar](20) NULL,
	[SupplierSKU] [nvarchar](20) NULL,
	[ProductDescription] [nvarchar](50) NULL,
	[ItemSize] [nvarchar](10) NULL,
	[ExpDate] [nvarchar](20) NULL,
	[ReasonID] [int] NULL,
	[QtyOrdered] [real] NULL,
	[QtyReceived] [real] NULL,
	[ItemWeight] [nvarchar](10) NULL,
	[UnitCost] [money] NULL,
	[ExtendedCost] [money] NULL,
	[DateReceived] [smalldatetime] NULL,
	[Committedln] [bit] NULL,
	[Flag] [bit] NULL,
 CONSTRAINT [PK_PurchaseOrdersDetails] PRIMARY KEY CLUSTERED 
(
	[LineID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO


/****** Object:  Table [dbo].[Suppliers_tbl]    Script Date: 7/9/2025 6:24:46 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Suppliers_tbl](
	[SupplierID] [int] IDENTITY(1,1) NOT NULL,
	[AccountNo] [nvarchar](13) NULL,
	[StateTaxID] [nvarchar](24) NULL,
	[BusinessName] [nvarchar](50) NULL,
	[Address1] [nvarchar](32) NULL,
	[Address2] [nvarchar](32) NULL,
	[City] [nvarchar](24) NULL,
	[State] [nvarchar](3) NULL,
	[ZipCode] [nvarchar](10) NULL,
	[Phone_Number] [nvarchar](13) NULL,
	[Fax_Number] [nvarchar](13) NULL,
	[Contactname] [nvarchar](50) NULL,
	[Email] [nvarchar](100) NULL,
	[web_url] [nvarchar](255) NULL,
	[Notes] [ntext] NULL,
	[Discontinued] [bit] NULL,
 CONSTRAINT [PK_Suppliers] PRIMARY KEY CLUSTERED 
(
	[SupplierID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO


/****** Object:  Table [dbo].[Shippers_tbl]    Script Date: 7/9/2025 6:26:02 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Shippers_tbl](
	[ShipperID] [int] IDENTITY(1,1) NOT NULL,
	[Shipper] [nvarchar](50) NULL,
 CONSTRAINT [PK_Shippers_tbl] PRIMARY KEY CLUSTERED 
(
	[ShipperID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO


/****** Object:  Table [dbo].[Employees_tbl]    Script Date: 7/9/2025 6:26:41 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Employees_tbl](
	[EmployeeID] [int] IDENTITY(1,1) NOT NULL,
	[EmployeeNo] [nvarchar](10) NULL,
	[FirstName] [nvarchar](20) NULL,
	[MiddleName] [nvarchar](20) NULL,
	[LastName] [nvarchar](20) NULL,
	[SSN] [nvarchar](20) NULL,
	[TitleID] [int] NULL,
	[Address1] [nvarchar](32) NULL,
	[Address2] [nvarchar](32) NULL,
	[City] [nvarchar](20) NULL,
	[State] [nvarchar](3) NULL,
	[ZipCode] [nvarchar](5) NULL,
	[HomePhone] [nvarchar](13) NULL,
	[Othr_Phone] [nvarchar](13) NULL,
	[Birthdate] [smalldatetime] NULL,
	[DateHired] [smalldatetime] NULL,
	[EmrgcyContactName] [nvarchar](50) NULL,
	[EmrgcyContactPhone] [nvarchar](13) NULL,
	[CommissionRate] [real] NULL,
	[Notes] [ntext] NULL,
 CONSTRAINT [PK_Employees] PRIMARY KEY CLUSTERED 
(
	[EmployeeID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, FILLFACTOR = 90, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY]
GO




