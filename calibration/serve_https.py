# -*- coding: utf-8 -*-
"""为 capture_test.html 提供 HTTPS 服务。

原因：手机浏览器的 getUserMedia 只在「安全上下文」可用，
即 HTTPS 或 localhost。用局域网 IP + http 访问会被浏览器直接禁用摄像头。
本脚本用 cryptography 生成自签证书（含 SAN=局域网 IP），一键起 HTTPS。

用法:
    python serve_https.py [--port 8443] [--dir .]

流程:
    1. 电脑运行本脚本
    2. 电脑浏览器打开 https://localhost:<port>/view_chart.html 全屏显示测试卡
    3. 手机（同一 WiFi）打开 https://<电脑IP>:<port>/capture_test.html
       Chrome/Edge 首次会警告 -> 点「高级」->「继续前往」信任自签证书
    4. 手机对准电脑屏幕拍摄，打包下载 ZIP
    5. 把 PNG 解到 calibration/photos/web/ 后运行 analyze_calibration.py

注意：Windows 防火墙首次可能弹窗，需允许 Python 通过（否则手机连不上）。
"""

import argparse
import datetime
import ipaddress
import os
import socket
import ssl
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

CERT_DIR = "_https_cert"


def lan_ip():
    """获取访问外网所用的局域网 IP（比 gethostname 可靠）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def cert_matches_ip(cert_path, ip):
    """缓存的证书是否已包含当前局域网 IP（换网络后需重签）。"""
    if not os.path.exists(cert_path):
        return False
    try:
        from cryptography import x509
        with open(cert_path, "rb") as f:
            cert = x509.load_pem_x509_certificate(f.read())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        return ip in [str(v) for v in san.value.get_values_for_type(x509.IPAddress)]
    except Exception:
        return False


def gen_cert(cert_path, key_path, ip):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"ColorTransfer-{ip}")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.IPv4Address(ip)),
            ]),
            critical=False,
        )
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    os.makedirs(os.path.dirname(cert_path) or ".", exist_ok=True)
    with open(key_path, "wb") as f:
        f.write(key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption()))
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return True


def gen_qr(url, path):
    """生成指向当前 URL 的二维码。局域网 IP 会因 DHCP 变化，每次启动都重生成。"""
    try:
        import qrcode
        q = qrcode.QRCode(box_size=10, border=4)
        q.add_data(url)
        q.make(fit=True)
        q.make_image().save(path)
        return True
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--dir", default=os.path.dirname(os.path.abspath(__file__)))
    args = ap.parse_args()

    ip = lan_ip()
    cert_path = os.path.join(args.dir, CERT_DIR, "cert.pem")
    key_path = os.path.join(args.dir, CERT_DIR, "key.pem")

    try:
        if not cert_matches_ip(cert_path, ip):
            print(f"[证书] 为 {ip} 生成自签证书 ...")
            gen_cert(cert_path, key_path, ip)
            print(f"[证书] {cert_path}")
        else:
            print(f"[证书] 复用现有证书（已含 {ip}）")
    except ImportError:
        print("!! 缺少 cryptography 库，无法生成证书。请执行: pip install cryptography")
        return 1

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=args.dir, **kw)

        def log_message(self, fmt, *a):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert_path, key_path)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)

    url_phone = f"https://{ip}:{args.port}/capture_test.html"
    qr_path = os.path.join(args.dir, "capture_qr.png")
    qr_ok = gen_qr(url_phone, qr_path)

    print("")
    print("=" * 58)
    print("  HTTPS 服务已启动（Ctrl+C / 关闭窗口即停止）")
    print("")
    print(f"  电脑显示测试卡 : https://localhost:{args.port}/view_chart.html")
    print(f"  手机拍摄(同WiFi): {url_phone}")
    if qr_ok:
        print(f"  二维码(已更新) : {qr_path}")
    else:
        print("  二维码未生成：缺 qrcode 库（pip install qrcode）")
    print("")
    print("  手机首次访问会警告证书 -> Chrome 点「高级」->「继续前往」")
    print("  若手机连不上，检查 Windows 防火墙是否允许 Python 入站")
    print("  注意：局域网 IP 可能因 DHCP 变化，请以本窗口显示的地址为准")
    print("=" * 58)
    print("")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n[停止] 服务已关闭")
    return 0


if __name__ == "__main__":
    sys.exit(main())
