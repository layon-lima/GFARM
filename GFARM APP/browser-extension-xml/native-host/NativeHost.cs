// GFARM: ponte local de certificados Windows para Chrome/Edge.
// Nunca exporta chaves privadas. Somente este processo faz TLS com a SEFAZ.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Xml;

internal static class GFARMNativeHost
{
    private const string Endpoint = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
    private const string SoapAction = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
    private const int MaxMessage = 32768;
    private const int MaxSoapBytes = 18 * 1024 * 1024;
    private const int MaxBatchChars = 15000000;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 25000000 };

    private static void Main()
    {
        try
        {
            var input = Console.OpenStandardInput();
            var length = new byte[4];
            if (!ReadFully(input, length, 4)) return;
            int size = BitConverter.ToInt32(length, 0);
            if (size < 2 || size > MaxMessage) throw new Exception("Mensagem da extensao invalida.");
            var payload = new byte[size];
            if (!ReadFully(input, payload, size)) throw new Exception("Mensagem incompleta.");
            var request = Json.DeserializeObject(Encoding.UTF8.GetString(payload)) as Dictionary<string, object>;
            if (request == null) throw new Exception("Comando invalido.");
            string operation = Value(request, "op");
            if (operation == "LISTAR")
            {
                var encontrados = new List<Dictionary<string, object>>();
                foreach (var cert in Certificados())
                {
                    string interessado = Identidade(cert);
                    if (interessado.Length != 11 && interessado.Length != 14) continue;
                    encontrados.Add(new Dictionary<string, object> {
                        { "thumbprint", cert.Thumbprint.ToUpperInvariant() },
                        { "interessado", interessado },
                        { "titular", cert.GetNameInfo(X509NameType.SimpleName, false) },
                        { "tipo", interessado.Length == 11 ? "CPF" : "CNPJ" },
                        { "vencimento", cert.NotAfter.ToString("yyyy-MM-dd") }
                    });
                }
                Answer(new { ok = true, certificados = encontrados });
            }
            else if (operation == "CONSULTAR")
            {
                Answer(Consultar(request));
            }
            else throw new Exception("Operacao nao permitida.");
        }
        catch (Exception err)
        {
            // Nao enviar stack trace, caminho de certificado, segredo ou corpo SOAP.
            Answer(new { ok = false, message = err.Message.Length > 240
                ? "Falha na ponte de certificados." : err.Message });
        }
    }

    private static string Value(Dictionary<string, object> obj, string key)
    {
        object found;
        return obj.TryGetValue(key, out found) && found != null ? Convert.ToString(found) : "";
    }

    private static bool ReadFully(Stream stream, byte[] buffer, int length)
    {
        int offset = 0;
        while (offset < length)
        {
            int received = stream.Read(buffer, offset, length - offset);
            if (received == 0) return false;
            offset += received;
        }
        return true;
    }

    private static void Frame(object message)
    {
        byte[] data = Encoding.UTF8.GetBytes(Json.Serialize(message));
        if (data.Length > 900000) throw new Exception("Resposta local muito grande.");
        Stream stdout = Console.OpenStandardOutput();
        byte[] length = BitConverter.GetBytes(data.Length);
        stdout.Write(length, 0, length.Length);
        stdout.Write(data, 0, data.Length);
        stdout.Flush();
    }

    private static void Answer(object result)
    {
        string body = Json.Serialize(result);
        if (body.Length <= 300000)
        {
            Frame(new { type = "result", value = result });
            return;
        }
        // Native Messaging: limite de 1 MB por quadro enviado pelo host.
        // Envia fragmentos pequenos que a extensao junta antes de interpretar.
        for (int offset = 0; offset < body.Length; offset += 240000)
        {
            Frame(new { type = "chunk", data = body.Substring(offset, Math.Min(240000, body.Length - offset)) });
        }
        Frame(new { type = "done" });
    }

    private static IEnumerable<X509Certificate2> Certificados()
    {
        var encontrados = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (StoreLocation location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using (var store = new X509Store(StoreName.My, location))
            {
                try { store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly); }
                catch { continue; }
                foreach (X509Certificate2 cert in store.Certificates)
                {
                    bool valido = false;
                    try
                    {
                        valido = cert.HasPrivateKey && cert.NotAfter > DateTime.Now &&
                            cert.NotBefore <= DateTime.Now &&
                            encontrados.Add(cert.Thumbprint);
                    }
                    catch { /* Certificado inacessivel: ignora. */ }
                    if (valido) yield return cert;
                }
            }
        }
    }

    private static string Identidade(X509Certificate2 cert)
    {
        // ICP-Brasil normalmente guarda CPF ou CNPJ apos ":" no CN.
        // Nao inferir pelo OU (pode conter CNPJ da autoridade certificadora).
        Match cn = Regex.Match(cert.Subject, @"(?:^|,\s*)CN\s*=\s*([^,]+)", RegexOptions.IgnoreCase);
        if (!cn.Success) return "";
        Match doc = Regex.Match(cn.Groups[1].Value.Trim(), @"(?:^|:)(\d{11}|\d{14})$");
        return doc.Success ? doc.Groups[1].Value : "";
    }

    private static object Consultar(Dictionary<string, object> req)
    {
        string thumbprint = Value(req, "thumbprint").ToUpperInvariant();
        string interessado = Value(req, "interessado");
        string uf = Value(req, "cuf");
        long anterior;
        if (!Regex.IsMatch(thumbprint, @"\A[A-F0-9]{40}\z") ||
            !Regex.IsMatch(interessado, @"\A(?:\d{11}|\d{14})\z") ||
            !Regex.IsMatch(uf, @"\A\d{2}\z") ||
            !long.TryParse(Value(req, "anterior_nsu"), out anterior) ||
            anterior < 0 || anterior > 999999999999999)
            throw new Exception("Certificado, CPF/CNPJ, UF ou NSU invalido.");

        X509Certificate2 escolhido = null;
        foreach (var c in Certificados())
            if (string.Equals(c.Thumbprint, thumbprint, StringComparison.OrdinalIgnoreCase) &&
                Identidade(c) == interessado) { escolhido = c; break; }
        if (escolhido == null) throw new Exception("Certificado nao encontrado ou titular diferente.");

        string campo = interessado.Length == 11 ? "CPF" : "CNPJ";
        string soap = "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
          "<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\">" +
          "<soap:Body><nfeDistDFeInteresse xmlns=\"" + SoapAction.Substring(0, SoapAction.LastIndexOf('/')) + "\">" +
          "<nfeDadosMsg><distDFeInt xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"1.01\">" +
          "<tpAmb>1</tpAmb><cUFAutor>" + uf + "</cUFAutor><" + campo + ">" +
          interessado + "</" + campo + "><distNSU><ultNSU>" +
          anterior.ToString("D15") + "</ultNSU></distNSU></distDFeInt></nfeDadosMsg>" +
          "</nfeDistDFeInteresse></soap:Body></soap:Envelope>";

        string resposta;
        using (var handler = new HttpClientHandler())
        {
            handler.ClientCertificateOptions = ClientCertificateOption.Manual;
            handler.ClientCertificates.Add(escolhido);
            handler.SslProtocols = SslProtocols.Tls12;
            using (var client = new HttpClient(handler))
            {
                client.Timeout = TimeSpan.FromSeconds(90);
                using (var content = new StringContent(soap, Encoding.UTF8))
                {
                    content.Headers.ContentType = MediaTypeHeaderValue.Parse(
                        "application/soap+xml; charset=utf-8; action=\"" + SoapAction + "\"");
                    using (var http = client.PostAsync(Endpoint, content).GetAwaiter().GetResult())
                    {
                        if (!http.IsSuccessStatusCode)
                            throw new Exception("A SEFAZ retornou HTTP " + (int)http.StatusCode + ".");
                        byte[] bytes = http.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult();
                        if (bytes.Length < 20 || bytes.Length > MaxSoapBytes)
                            throw new Exception("Resposta da SEFAZ fora do tamanho permitido.");
                        resposta = Encoding.UTF8.GetString(bytes);
                    }
                }
            }
        }

        var settings = new XmlReaderSettings {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            MaxCharactersInDocument = MaxSoapBytes
        };
        var xml = new XmlDocument { XmlResolver = null };
        using (var reader = XmlReader.Create(new StringReader(resposta), settings))
            xml.Load(reader);
        XmlNode retorno = xml.SelectSingleNode("//*[local-name()='retDistDFeInt']");
        if (retorno == null) throw new Exception("Resposta da SEFAZ sem dados fiscais.");

        string status = Text(retorno, "cStat");
        if (status != "137" && status != "138" && status != "656")
            throw new Exception("SEFAZ retornou codigo " + status + ". Nenhum XML foi salvo.");
        long ult = Nsu(Text(retorno, "ultNSU"), anterior);
        long max = Nsu(Text(retorno, "maxNSU"), anterior);
        if (ult < anterior || max < ult)
            throw new Exception("Sequencia NSU invalida retornada pela SEFAZ.");

        var documentos = new List<Dictionary<string, object>>();
        int total = 0;
        XmlNodeList nodes = retorno.SelectNodes(".//*[local-name()='docZip']");
        foreach (XmlNode item in nodes)
        {
            long nsu;
            if (item.Attributes == null || item.Attributes["NSU"] == null ||
                !long.TryParse(item.Attributes["NSU"].Value, out nsu) ||
                nsu <= anterior || nsu > ult)
                throw new Exception("Documento da SEFAZ com NSU invalido.");
            string zip = Regex.Replace(item.InnerText, @"\s+", "");
            if (!Regex.IsMatch(zip, @"\A[A-Za-z0-9+/]+=*\z"))
                throw new Exception("Documento compactado invalido.");
            total += zip.Length;
            if (total > MaxBatchChars || documentos.Count >= 50)
                throw new Exception("Lote maior que o limite de seguranca.");
            string schema = item.Attributes["schema"] != null ? item.Attributes["schema"].Value : "";
            documentos.Add(new Dictionary<string, object> {
                { "nsu", nsu }, { "schema_xml", schema }, { "doc_zip", zip }
            });
        }
        if ((status == "138" && documentos.Count == 0) ||
            (status != "138" && documentos.Count > 0))
            throw new Exception("Status SEFAZ e documentos inconsistentes.");
        return new { ok = true, cstat = status, ult_nsu = ult, max_nsu = max, documentos = documentos };
    }

    private static long Nsu(string value, long fallback)
    {
        if (string.IsNullOrEmpty(value)) return fallback;
        long result;
        if (!long.TryParse(value, out result) || result < 0 || result > 999999999999999)
            throw new Exception("NSU retornado invalido.");
        return result;
    }

    private static string Text(XmlNode parent, string name)
    {
        XmlNode node = parent.SelectSingleNode("./*[local-name()='" + name + "']");
        return node == null ? "" : node.InnerText.Trim();
    }
}
