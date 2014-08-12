import functools
import json


def as_json(func):
    """Returns json when callback in url"""
    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        self.response.headers["Content-Type"] = "application/json"
        try:
            resp = func(self, *args, **kwargs)
            if resp is None:
                resp = {}
        except Exception as e:
            self.response.set_status(400)
            resp = {"error": e.__class__.__name__, "message": e.message}
        if not isinstance(resp, str) and not isinstance(resp, unicode):
            resp = json.dumps(resp, default=json_extras)
        callback = self.request.get("callback")
        if callback:
            self.response.headers["Content-Type"] = "text/javascript"
            resp = "%s(%s);".format(callback, resp)
        self.response.headers["Access-Control-Allow-Origin"] = "*"
        self.response.headers["Access-Control-Allow-Methods"] = "POST,GET,PUT,PATCH,HEAD,OPTIONS"
        self.response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        self.response.out.write(resp)
    return wrapper


# Extensions to the jsonifying of python results
def json_extras(obj):
    """Extended json processing of types."""
    if hasattr(obj, "strftime"):  # datetime or date
        return obj.isoformat()
    if isinstance(obj, set):
        return list(obj)
    return None
