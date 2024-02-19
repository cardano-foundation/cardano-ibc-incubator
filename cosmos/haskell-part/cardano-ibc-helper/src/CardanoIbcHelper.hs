{-# LANGUAGE CPP                      #-}
{-# LANGUAGE ForeignFunctionInterface #-}
{-# OPTIONS_GHC -fno-warn-unused-top-binds #-}
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE BlockArguments #-}
{-# LANGUAGE RankNTypes #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GADTs #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE TypeFamilies #-}
{-# LANGUAGE UndecidableInstances #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE DerivingVia #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE LambdaCase #-}
{-# OPTIONS_GHC -Wno-orphans #-}
{-# OPTIONS_GHC -Wno-missing-signatures #-}
{-# OPTIONS_GHC -Wno-unrecognised-pragmas #-}
{-# HLINT ignore "Use camelCase" #-}

module CardanoIbcHelper (
  VerifyBlockOutput(..),
  verifyHeaderPraos,
  verifyBlock,
  extractBlockData,
) where

import           Foreign
import           Foreign.C.String
import           Foreign.C.Types
import           Foreign.Ptr
import           Foreign.StablePtr
import           Data.Int          (Int32)

import System.IO.Unsafe (unsafePerformIO)
import Data.Word (Word64)
import qualified Data.ByteString as BS
import Data.ByteString.Lazy as BL
import qualified Data.ByteString.Short as SBS
import Data.ByteString.Base16 (decodeLenient, decode)
import qualified Data.ByteString.Base16.Lazy as B16L
import qualified Data.ByteString.Char8 as C8BS

import qualified Data.ByteString.Base16 as B16

import Data.Text.Lazy as TL
import Data.Text.Lazy.Encoding as TL

import Data.List as List

import Data.Text (Text)
import qualified Data.Text as Text
import qualified Data.Text.Encoding as Text
import Codec.Binary.Bech32
import Data.Aeson (FromJSON(..), ToJSON(..))

import Cardano.Ledger.BaseTypes
import Cardano.Ledger.Address (Addr(..), putAddr)
import Cardano.Ledger.Binary
    ( EncCBOR(..),
      DecCBOR(..),
      Sized (..),
      encCBOR,
      decCBOR,
      decodeFullAnnotator )
import Cardano.Ledger.Crypto (StandardCrypto)
import Cardano.Ledger.Babbage (Babbage)
import Cardano.Ledger.Babbage.TxOut
import Cardano.Ledger.Babbage.TxOut (BabbageTxOut (..), getEitherAddrBabbageTxOut, getDatumBabbageTxOut, txOutScript)
import Cardano.Ledger.Core (eraProtVerHigh, EraTxOut(..), Value(..))
import Cardano.Ledger.Compactible

-- import Cardano.Protocol.TPraos.BHeader (BHeader)
import qualified Cardano.Protocol.TPraos.OCert as SL

import Ouroboros.Consensus.Protocol.Praos.Header (Header (Header), HeaderBody (..))
import Ouroboros.Consensus.Protocol.Praos.VRF (mkInputVRF)

import qualified Cardano.Crypto.KES as KES
import qualified Cardano.Crypto.VRF as VRF
import qualified Cardano.Crypto.Hash as Hash

import Cardano.Ledger.Babbage.TxBody (BabbageTxBody (BabbageTxBody, btbOutputs, btbCerts), Datum(..))
import Cardano.Ledger.Babbage.TxWits (AlonzoTxWits (..))
import Cardano.Ledger.Mary.Value (MaryValue(..), MultiAsset (..), PolicyID (..), AssetName (..), flattenMultiAsset)
import Cardano.Ledger.Alonzo.TxAuxData (AlonzoTxAuxData, hashAlonzoTxAuxData, mkAlonzoTxAuxData)
import qualified Cardano.Ledger.Alonzo.TxInfo as Alonzo
import Cardano.Ledger.Alonzo.Scripts.Data (Data (Data), BinaryData, binaryDataToData)
import Cardano.Ledger.Val (Val (..))
import Cardano.Ledger.Shelley.TxCert(ShelleyTxCert (..), PoolCert (..))
import Cardano.Ledger.Shelley.Scripts (ScriptHash (..))
import Cardano.Ledger.PoolParams (PoolParams (..))
import Cardano.Ledger.Keys (KeyHash (..), KeyRole (..))
import Cardano.Ledger.MemoBytes (MemoBytes(..), getMemoBytesHash)
import Cardano.Ledger.SafeHash (SafeHash, extractHash, hashAnnotated, originalBytes)
import qualified Data.Map.Strict as Map
import qualified Data.Sequence.Strict as StrictSeq
import Data.Sequence.Strict (StrictSeq(..), length, lookup)
import Cardano.Ledger.Alonzo.TxSeq (AlonzoTxSeq (AlonzoTxSeq, txSeqTxns), TxSeq, hashTxSeq, hashAlonzoTxSeq)

import Cardano.Ledger.Alonzo.Tx (AlonzoTx (AlonzoTx, body), IsValid (..), AlonzoTxBody (..))
import Cardano.Crypto.Hash.Class (hashToStringAsHex, hashToBytes)
import Cardano.Crypto.VRF.Praos(vkBytes)

import Data.Bool (Bool(..))
import qualified Data.Binary as B
import qualified Data.Binary.Put as B

import Codec.Serialise
import GHC.Generics

import Data.Typeable
import Debug.Trace

data VerifyBlockOutput = VerifyBlockOutput { 
    isValid :: Bool, 
    vrfKHexString :: String
    -- outputs :: [UTXOOutput],
    -- regisCerts :: [RegisCert],
    -- deRegisCerts :: [DeRegisCert]
  }
  deriving (Generic, Show)
instance Serialise VerifyBlockOutput

data ExtractBlockOutput = ExtractBlockOutput { 
    outputs :: [UTXOOutput],
    regisCerts :: [RegisCert],
    deRegisCerts :: [DeRegisCert]
  }
  deriving (Generic, Show)
instance Serialise ExtractBlockOutput

data UTXOOutput = UTXOOutput { 
    txHash :: String,
    outputIndex :: String,
    tokens :: [UTXOOutputToken],
    datumHex :: String
  }
  deriving (Generic, Show)
instance Serialise UTXOOutput

data UTXOOutputToken = UTXOOutputToken { 
    tokenAssetName :: String,
    tokenValue :: String
  }
  deriving (Generic, Show)
instance Serialise UTXOOutputToken

data RegisCert = RegisCert { 
    regisPoolId :: String,
    regisPoolVrf :: String
  }
  deriving (Generic, Show)
instance Serialise RegisCert

data DeRegisCert = DeRegisCert { 
    deRegisPoolId :: String,
    deRegisEpoch :: String
  }
  deriving (Generic, Show)
instance Serialise DeRegisCert

data BlockHexCbor = BlockHexCbor { headerCbor :: String, eta0 :: String, spk:: Int, blockBodyCbor:: String}
            deriving (Generic, Show)
instance Serialise BlockHexCbor

fUnwrap :: Maybe a -> a
fUnwrap (Just n) = n
fUnwrap Nothing = error "Nothing has no value"


getHeaderBody (Ouroboros.Consensus.Protocol.Praos.Header.Header hBody _) = hBody
getHeaderSig (Ouroboros.Consensus.Protocol.Praos.Header.Header _ sig) = sig

-- spkp => slotsPerKESPeriod 
verifyHeaderPraos:: BL.ByteString -> Word64 -> Hash.ByteString -> (String , String , Bool)
verifyHeaderPraos headerHex spkp epochNonce = do
  let (cborBytesBlock, ok) =
              case B16L.decode headerHex of
                Left err -> (error err, False)
                Right val -> (val, True)
  if ok then do
    let header =
                case decodeFullAnnotator (eraProtVerHigh @Babbage) "" decCBOR cborBytesBlock of
                  Left err -> error (show err)
                  Right (_h :: Ouroboros.Consensus.Protocol.Praos.Header.Header StandardCrypto) -> _h
        -- hHash = headerHash header
        hBody = getHeaderBody header
        hBodyHash = hbBodyHash hBody
        hBodySig = getHeaderSig header
        SL.OCert
          { SL.ocertVkHot = ocertVkHot,
            SL.ocertKESPeriod = SL.KESPeriod startOfKesPeriod
          } = hbOCert hBody

        currentKesPeriod =
          fromIntegral $
            unSlotNo (hbSlotNo hBody) `div` spkp
        t
          | currentKesPeriod >= startOfKesPeriod =
              currentKesPeriod - startOfKesPeriod
          | otherwise =
              0
        isKESRight = case KES.verifySignedKES () ocertVkHot t hBody hBodySig of
            Left _ -> False
            Right _ -> True
        -- =========================================
        epochNonceByte = Data.ByteString.Base16.decodeLenient epochNonce
        eta0 = case Hash.hashFromBytes epochNonceByte of
          Nothing -> Nonce (Hash.castHash (Hash.hashWith id epochNonceByte))
          Just hash -> Nonce $! hash
        slot = hbSlotNo hBody
        vrfK = hbVrfVk hBody
        vrfCert = hbVrfRes hBody
        isVRFRight = VRF.verifyCertified
          ()
          vrfK
          (mkInputVRF slot eta0)
          vrfCert
        vrfKBytes = VRF.rawSerialiseVerKeyVRF vrfK
        vrfKHex = B16.encode vrfKBytes
        vrfHexString = Text.unpack (Text.decodeLatin1 vrfKHex)
    (vrfHexString, hashToStringAsHex hBodyHash, isKESRight && isVRFRight)
  else 
    ("", "", False)

convertCStringToString :: CString -> String
convertCStringToString cstr = unsafePerformIO $ do
    peekCString cstr

verifyHeaderPraos_hs :: CString -> CInt -> CString -> Bool
verifyHeaderPraos_hs cstr spkp epochNonce = do
  let str = convertCStringToString cstr
      strBL = TL.encodeUtf8 (TL.pack str)
      spkpW64 = fromIntegral spkp
      epochNonceStr = convertCStringToString epochNonce
      epochBL = TL.encodeUtf8 (TL.pack epochNonceStr)
      epochBLStrict = BL.toStrict epochBL
      (_, _, isValid) = verifyHeaderPraos strBL spkpW64 epochBLStrict
  isValid


foreign export ccall verifyBlock_hs :: CString -> CString
verifyBlock_hs cbor = do
  let str = convertCStringToString cbor
      verifyOutput = verifyBlock str
      verifyBlockOutput = Text.unpack (Text.decodeLatin1 (BL.toStrict (B16L.encode (serialise verifyOutput))))
  unsafePerformIO $ newCString verifyBlockOutput

verifyBlock :: String -> VerifyBlockOutput
verifyBlock cborStr = do
  let strBL = TL.encodeUtf8 (TL.pack cborStr)
      (blockHexCborBL, ok) = case B16L.decode strBL of
          Left err -> (error err, False)
          Right val -> (val, True)
      blockHexCbor = deserialise blockHexCborBL :: BlockHexCbor
      headerCborAgr = headerCbor blockHexCbor
      headerCborAgrBL = TL.encodeUtf8 (TL.pack headerCborAgr)
      eta0Agr = eta0 blockHexCbor
      eta0AgrBL = TL.encodeUtf8 (TL.pack eta0Agr)
      eta0AgrBLStrict = BL.toStrict eta0AgrBL
      spkAgr = fromIntegral (spk blockHexCbor)
      blockBodyCborAgr = blockBodyCbor blockHexCbor
      (vrfKHexString, blockBodyHash, isHeaderValid) = verifyHeaderPraos headerCborAgrBL spkAgr eta0AgrBLStrict
      isBodyValid = verifyBlockBody blockBodyCborAgr blockBodyHash
      isValid = isHeaderValid && isBodyValid
      verifyBlockOutput = VerifyBlockOutput isValid vrfKHexString
  verifyBlockOutput


foreign export ccall extractBlockData_hs :: CString -> CString
extractBlockData_hs cbor = do
  let str = convertCStringToString cbor
      extractBlockDataOutput = extractBlockData str
      extractBlockDataOutputString = Text.unpack (Text.decodeLatin1 (BL.toStrict (B16L.encode (serialise extractBlockDataOutput))))
  unsafePerformIO $ newCString extractBlockDataOutputString

extractBlockData :: String -> ExtractBlockOutput
extractBlockData cborStr = do
  let bodyArray = decodeBodyArray cborStr
      (outputLists, regisList, deRegisList) = getBlockBodyDataWithCerts bodyArray
      regisListObject = buildRegisCertList regisList []
      deRegisListObject = buildDeRegisCertList deRegisList []
      outputListObject = buildOutputList outputLists []
      blockOutput = ExtractBlockOutput outputListObject regisListObject deRegisListObject
  blockOutput
  where
    decodeBodyArray :: String -> [(String, String, String)]
    decodeBodyArray blockBodyCborString = do
      let blockBodyCbor = TL.encodeUtf8 (TL.pack blockBodyCborString)
          (blockBodyCborBL, ok) = case B16L.decode blockBodyCbor of
            Left err -> (error err, False)
            Right val -> (val, True)
          bodyArray = deserialise blockBodyCborBL :: [(String, String, String)]
      bodyArray

verifyBlockBody :: String -> String -> Bool
verifyBlockBody blockBodyCborString blockBodyHash = do
  let blockBodyCbor = TL.encodeUtf8 (TL.pack blockBodyCborString)
      (blockBodyCborBL, ok) = case B16L.decode blockBodyCbor of
          Left err -> (error err, False)
          Right val -> (val, True)
      bodyArray = deserialise blockBodyCborBL :: [(String, String, String)]
      txSeqHash = getBlockBodyData bodyArray
      isBodyMatched = txSeqHash == blockBodyHash
  isBodyMatched

buildRegisCertList :: [(String, String)] -> [RegisCert] -> [RegisCert]
buildRegisCertList [] a = a
buildRegisCertList ((regisPoolId, regisPoolVrf):xs) certs = do
  let cert = RegisCert regisPoolId regisPoolVrf
  buildRegisCertList xs (certs ++ [cert])
buildDeRegisCertList :: [(String, String)] -> [DeRegisCert] -> [DeRegisCert]
buildDeRegisCertList [] a = a
buildDeRegisCertList ((deRegisPoolId, deRegisEpoch):xs) certs = do
  let cert = DeRegisCert deRegisPoolId deRegisEpoch
  buildDeRegisCertList xs (certs ++ [cert])

buildOutputList :: [(String, String, [(String, String)], String)] -> [UTXOOutput] -> [UTXOOutput]
buildOutputList [] a = a
buildOutputList ((txHash, outputIndex, tokens, datumHex):xs) outputList = do
  let tokenList = buildTokenList tokens []
      outputInfo = UTXOOutput txHash outputIndex tokenList datumHex
  buildOutputList xs (outputList ++ [outputInfo])

buildTokenList :: [(String, String)] -> [UTXOOutputToken] -> [UTXOOutputToken]
buildTokenList [] a = a
buildTokenList ((tokenAssetName, tokenValue):xs) tokenList = do
  let token = UTXOOutputToken tokenAssetName tokenValue
  buildTokenList xs (tokenList ++ [token])

getBlockBodyData :: [(String, String, String)] -> String
getBlockBodyData bodyArray = do
  let bodyLength = Prelude.length bodyArray
      txs = Prelude.map convertToTx bodyArray
      txSeq = if bodyLength == 0 then
        AlonzoTxSeq @Babbage StrictSeq.empty
      else do
        AlonzoTxSeq $ StrictSeq.fromList txs
      hashTxs = hashAlonzoTxSeq txSeq
      txSeqHash = hashToStringAsHex hashTxs
  txSeqHash

getBlockBodyDataWithCerts :: [(String, String, String)] -> 
  ([(String, String, [(String, String)], String)], [(String, String)], [(String, String)])
getBlockBodyDataWithCerts bodyArray = do
  let bodyLength = Prelude.length bodyArray
      txs = Prelude.map convertToTx bodyArray
      (utxoDatas, regisCerts, deRegisCerts) = extractTxData txs [] [] []
  (utxoDatas, regisCerts, deRegisCerts)

convertToTx :: (String, String, String) -> AlonzoTx Babbage
convertToTx (txBodyCborString, txWitnessCborString, txAuxCborString) = do
  let cborTxBodyBL = TL.encodeUtf8 (TL.pack txBodyCborString)
      (cborTxBody, ok) =
          case B16L.decode cborTxBodyBL of
            Left err -> (error err, False)
            Right val -> (val, True)
      txBody = case decodeFullAnnotator (eraProtVerHigh @Babbage) "" decCBOR cborTxBody of
                  Left err -> error (show err)
                  Right (_h:: BabbageTxBody Babbage) -> _h

  let cborTxWitsBL = TL.encodeUtf8 (TL.pack txWitnessCborString)
      (cborTxWits, ok) =
          case B16L.decode cborTxWitsBL of
            Left err -> (error err, False)
            Right val -> (val, True)
      txWits = case decodeFullAnnotator (eraProtVerHigh @Babbage) "" decCBOR cborTxWits of
                  Left err -> error (show err)
                  Right (_h:: AlonzoTxWits Babbage) -> _h

  let cborTxAuxBL = TL.encodeUtf8 (TL.pack txAuxCborString)
      (cborTxAux, ok) =
          case B16L.decode cborTxAuxBL of
            Left err -> (error err, False)
            Right val -> (val, True)
      txAux = case decodeFullAnnotator (eraProtVerHigh @Babbage) "" decCBOR cborTxAux of
                  Left _ -> mkAlonzoTxAuxData Map.empty StrictSeq.empty
                  Right (_h:: AlonzoTxAuxData Babbage) -> _h   

  AlonzoTx txBody txWits (IsValid True) $ if txAuxCborString == "" then SNothing else SJust txAux

seqToList :: StrictSeq.StrictSeq a -> [a]
seqToList (x StrictSeq.:<| rest) = x : seqToList rest
seqToList StrictSeq.Empty        = []

getRawKeyHash :: KeyHash StakePool h -> Hash.ByteString
getRawKeyHash (KeyHash hsh) = Hash.hashToBytesAsHex hsh

assetNameToBytesAsHex :: AssetName -> BS.ByteString
assetNameToBytesAsHex = B16.encode . SBS.fromShort . assetName

assetNameToTextAsHex :: AssetName -> String
assetNameToTextAsHex = Text.unpack . Text.decodeLatin1 . assetNameToBytesAsHex

-- output will be:
-- (
--   // Output info
--   [
--     (
--       txHash: Hex String, 
--       outputIndex: Int String, 
--       // Token and value
--       [(
--         assetName: Hex String, assetValue: Int String
--       )], 
--       datumHex
--     )
--   ], 
--   // Pool regis
--   [(poolIdHex: Hex String, vrfHex: Hex String)], 
--   // Pool deregis
--   [(poolIdHex: Hex String, epochNo: Int String)]
-- )
extractTxData :: [AlonzoTx Babbage] -> 
    [(String, String, [(String, String)], String)] -> 
    [(String, String)] -> [(String, String)] -> 
    ([(String, String, [(String, String)], String)], [(String, String)], [(String, String)])
extractTxData [] a b c = (a, b, c)
extractTxData (tx:rest) accOutput accRegCert accDeRegCert = do
  let txBody = body tx
      txHash = Hash.hashToBytes (extractHash (hashAnnotated txBody))
      txHashByte = B16.encode txHash
      txHashString = Text.unpack (Text.decodeLatin1 txHashByte)
      outputs = btbOutputs txBody
      outputsList = seqToList outputs
      outputUTXOs = extractUTXOs (List.zip [0..] outputsList) txHashString []
      certs = btbCerts txBody
      certsList = seqToList certs
      (regCerts, deRegCerts) = filterCerts certsList [] []
  extractTxData rest (accOutput ++ outputUTXOs) (accRegCert ++ regCerts) (accDeRegCert ++ deRegCerts)
  where
    filterCerts :: [ShelleyTxCert Babbage] -> [(String, String)] -> [(String, String)] -> ([(String, String)], [(String, String)])
    filterCerts [] a b = (a,b)
    filterCerts (x:xs) regCerts deRegCerts = case x of
      ShelleyTxCertPool (RegPool poolParams) -> do
        let poolVrf = ppVrf poolParams
            poolVrfByte = B16.encode (Hash.hashToBytes poolVrf)
            poolVrfString = Text.unpack (Text.decodeLatin1 poolVrfByte)
            poolId = ppId poolParams
            poolIdRawKeyHash = getRawKeyHash poolId
            poolIdString = poolIDToBech32 poolIdRawKeyHash
        filterCerts xs (regCerts ++ [(poolIdString, poolVrfString)]) deRegCerts
      ShelleyTxCertPool (RetirePool poolId epochNo) -> do
        let poolIdRawKeyHash = getRawKeyHash poolId
            poolIdString = poolIDToBech32 poolIdRawKeyHash
            epochNoString = show (unEpochNo epochNo)
        filterCerts xs regCerts (deRegCerts ++ [(poolIdString, epochNoString)])
      _ -> filterCerts xs regCerts deRegCerts
    extractUTXOs :: [(Int, Sized (TxOut Babbage))] -> 
      String -> [(String, String, [(String, String)], String)] -> 
      [(String, String, [(String, String)], String)]
    extractUTXOs [] a b = b
    extractUTXOs ((index, x):xs) txHash accOut = do
      let outData = sizedValue x
          (BabbageTxOut addr val datum mRefScript) = outData
          (MaryValue lovelaceVal multiAssets) = val
          multiAssetsList = flattenMultiAsset multiAssets
          multiAssetsExtracted = extractMultiAsset multiAssetsList [("lovelance", show lovelaceVal)]
          datumHexString = case datum of 
            NoDatum -> ""
            Datum d -> do
              let datumBytes = originalBytes d
                  datumString = Text.unpack (Text.decodeLatin1 (B16.encode datumBytes))
              datumString
            DatumHash dh -> do
              let datumHashBytes = originalBytes dh
                  datumHashString = Text.unpack (Text.decodeLatin1 (B16.encode datumHashBytes))
              datumHashString
      extractUTXOs xs txHash (accOut ++ [(txHash, show index, multiAssetsExtracted, datumHexString)])
    extractMultiAsset :: [(PolicyID c, AssetName, Integer)] -> [(String, String)] -> [(String, String)]
    extractMultiAsset [] a = a
    extractMultiAsset ((policyID, name, value):xs) assets = do
      let (PolicyID (ScriptHash policyIDHash)) = policyID
          policyIDHashString = Text.unpack (Text.decodeLatin1 (B16.encode (Hash.hashToBytes policyIDHash)))
          shortNameString = assetNameToTextAsHex name
          assetName = policyIDHashString ++ shortNameString
      extractMultiAsset xs (assets ++ [(assetName, show value)])
    poolIDToBech32 str = do
      let Right prefix = humanReadablePartFromText "pool"
          msgBytes = case Data.ByteString.Base16.decode str of
            Right a -> a
            Left _ -> error "Decode poolID failed"
          dataPart = dataPartFromBytes msgBytes
          poolIdString = case Codec.Binary.Bech32.encode prefix dataPart of
            Right a -> a
            Left _ -> error "Encode poolID failed"
      Text.unpack poolIdString


foreign export ccall verifyHeaderPraos_hs :: CString -> CInt -> CString -> Bool