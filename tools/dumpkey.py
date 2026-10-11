import frida, sys, time, os

exe, js, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
os.chdir(os.path.dirname(exe))
src = open(js, encoding="utf-8").read()
pid = frida.spawn([exe])
sess = frida.attach(pid)
script = sess.create_script(src)
script.on("message", lambda m, d: print(m.get("payload", m), flush=True))
script.load()
frida.resume(pid)
time.sleep(secs)
try:
    frida.kill(pid)
except Exception as e:
    print("kill:", e)
