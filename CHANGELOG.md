# Change Log - tslog

This log was last generated on Sat, 18 Apr 2020 07:01:19 GMT and should not be manually modified.

## 2.0.0: 
Sun, 24 Mai 2020 23:35:19 GMT
- Setting `logAsJson` replaced with `type` = `pretty` | `json` ('pretty' is default)
- `chalk` dependency removed (hexadecimal colors are no longer supported)
- Color settings based on Node.js `utils.ispect.colors` 
- Error object displays additional `details` and exposes `nativeError`
- When `type`is set to `json`, hide `nativeError` and expose stringified version as `errorString`

## 1.0.0
Thu, 30 Apr 2020 07:01:19 GMT

*Initial release*

