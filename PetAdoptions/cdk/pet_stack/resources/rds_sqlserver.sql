USE [master]
GO

/****** Object:  Database [adoptions]    Script Date: 4/24/2020 2:02:30 PM ******/
CREATE DATABASE [adoptions]
 CONTAINMENT = NONE
 ON  PRIMARY 
( NAME = N'adoptions', FILENAME = N'D:\rdsdbdata\DATA\adoptions.mdf' , SIZE = 8192KB , MAXSIZE = UNLIMITED, FILEGROWTH = 10%)
 LOG ON 
( NAME = N'adoptions_log', FILENAME = N'D:\rdsdbdata\DATA\adoptions_log.ldf' , SIZE = 1024KB , MAXSIZE = 2048GB , FILEGROWTH = 10%)
GO



USE [adoptions]
GO

/****** Object:  Table [dbo].[Transactions]    Script Date: 4/23/2020 10:07:28 PM ******/
SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[Transactions](
	[Id] [int] IDENTITY(1,1) NOT NULL,
	[PetId] [nvarchar](50) NULL,
	[Adoption_Date] [datetime] NULL,
	[Transaction_Id] [nvarchar](50) NULL,
PRIMARY KEY CLUSTERED 
(
	[Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]
) ON [PRIMARY]
GO

