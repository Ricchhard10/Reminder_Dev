# Seguridad y publicación

Estas apps almacenan registros en SQLite dentro del dispositivo. El código propio no contiene backend, analítica, cuentas de usuario, solicitudes HTTP ni registro de tokens push. No es una garantía de seguridad absoluta ni una auditoría completa de todas las dependencias.

## Datos locales

- No guardar contraseñas, números completos de tarjeta ni secretos en los campos de texto.
- La base no tiene cifrado adicional de aplicación. La protección depende también del bloqueo, del sistema operativo y de la seguridad del dispositivo.
- Las copias de seguridad y transferencias del sistema operativo pueden incluir datos locales. No se han desactivado las copias ni borrado datos existentes.
- Desinstalar la app o borrar los datos de Expo Go puede eliminar los registros. Esta versión no incluye exportación/restauración de datos.
- En Reminder Dev los avisos nuevos son genéricos: no incluyen nombre, nota ni importe del pago. Los avisos programados con versiones anteriores conservan su contenido hasta cancelarlos o reprogramarlos al editar el pago.

## Repositorio público

- Publicar código y assets revisados, no toda la carpeta de desarrollo como ZIP. No incluir bases, logs, secretos, archivos de firma, carpetas de caché o configuraciones personales.
- El archivo `.gitignore` excluye esos archivos, pero no elimina lo ya registrado en Git ni protege contra `git add -f`.
- Revisar archivos preparados e historial antes del primer push. Los commits contienen nombres y correos de autor y de committer; usar el correo privado noreply proporcionado por GitHub. Cambiar la configuración solo afecta a commits nuevos, no a los antiguos.
- No colocar secretos en variables `EXPO_PUBLIC_*`: quedan accesibles desde la aplicación compilada.
- Mantener `package-lock.json` versionado y usar `npm ci --ignore-scripts` para instalaciones reproducibles sin scripts de ciclo de vida. `private: true` evita publicar accidentalmente en npm; no impide que el repositorio de GitHub sea público.
- No publicar datos sensibles en issues o capturas. Si alguna credencial se expone, revocarla; borrar el archivo no basta.

## Dependencias y permisos

Se fija únicamente la dependencia `xcode > uuid` en `11.1.1` para corregir [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). Se comprobó la compatibilidad con la función `uuid.v4()` usada por node-xcode y la resolución de los plugins de Expo. Revisar esta excepción al actualizar Expo. No usar `npm audit fix --force` sin evaluar los cambios.

En compilaciones propias de Android se bloquean almacenamiento externo y superposición sobre otras apps, que estas apps no necesitan. Inventary Dev también bloquea vibración. Expo Go conserva los permisos de su propia aplicación: los bloqueos no cambian Expo Go.

Para desarrollar solo en el simulador de tu Mac: `npm run start:local`. Para abrir en un teléfono, usar `npm start` en una red de confianza. No exponer el servidor de desarrollo a Internet.

## Referencias

- [Privacidad del correo de commits](https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address)
- [Permisos en la configuración de Expo](https://docs.expo.dev/versions/v57.0.0/config/app/#blockedpermissions)
- [Notificaciones locales y Expo Go](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)
