"""Poll the size of a file in an app's Documents over AFC and print progress lines."""
import asyncio, inspect, os, sys, time
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.house_arrest import HouseArrestService

bundle, remote, local = sys.argv[1], sys.argv[2], sys.argv[3]
total = os.path.getsize(local)


async def aw(v):
    return await v if inspect.isawaitable(v) else v


async def size_now():
    ld = await aw(create_using_usbmux())
    async with await HouseArrestService.create(lockdown=ld, bundle_id=bundle, documents_only=True) as afc:
        st = await aw(afc.stat(remote))
        return int(st.get("st_size", 0))


async def main():
    last = -1
    while True:
        try:
            size = await size_now()
        except Exception as e:
            size = None
            print(f"確認失敗: {type(e).__name__}: {e}", flush=True)
        if size is not None and size != last:
            print(f"{size * 100 / total:5.1f}%  {size / 1e6:,.0f} / {total / 1e6:,.0f} MB", flush=True)
            last = size
            if size >= total:
                print("転送完了（サイズ一致）", flush=True)
                return
        await asyncio.sleep(5)


asyncio.run(main())
