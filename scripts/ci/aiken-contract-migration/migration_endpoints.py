"""Read provider ports from the explicitly selected disposable runtime."""


def loopback_address(config, service, target):
    ports = [port for port in config['services'][service].get('ports', [])
             if isinstance(port, dict) and int(port.get('target', 0)) == target]
    if len(ports) != 1 or ports[0].get('host_ip') != '127.0.0.1':
        raise ValueError(f'Expected one owned {service}:{target} binding on loopback')
    port = int(ports[0].get('published', 0))
    if not 1 <= port <= 65535:
        raise ValueError(f'Invalid published port for {service}:{target}')
    return f'127.0.0.1:{port}'
