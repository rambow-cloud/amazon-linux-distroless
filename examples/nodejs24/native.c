#include <node_api.h>

static napi_value add(napi_env env, napi_callback_info info) {
    size_t count = 2;
    napi_value args[2], result;
    double a, b;
    if (napi_get_cb_info(env, info, &count, args, NULL, NULL) != napi_ok || count != 2 ||
        napi_get_value_double(env, args[0], &a) != napi_ok || napi_get_value_double(env, args[1], &b) != napi_ok) {
        napi_throw_type_error(env, NULL, "Two numeric arguments required");
        return NULL;
    }
    napi_create_double(env, a + b, &result);
    return result;
}
NAPI_MODULE_INIT() {
    napi_value function;
    napi_create_function(env, "add", NAPI_AUTO_LENGTH, add, NULL, &function);
    napi_set_named_property(env, exports, "add", function);
    return exports;
}
