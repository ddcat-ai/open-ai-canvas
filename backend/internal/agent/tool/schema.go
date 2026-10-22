package tool

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

// SchemaFor emits the object boundary for typed tool arguments. Cross-field
// business rules still run in the executor; this does not replace Pi validation.
func SchemaFor[T any]() json.RawMessage {
	typ := reflect.TypeFor[T]()
	if typ.Kind() != reflect.Struct {
		panic("tool arguments must be a struct")
	}
	properties := make(map[string]any, typ.NumField())
	required := []string{}
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		parts := strings.Split(field.Tag.Get("json"), ",")
		if parts[0] == "" || parts[0] == "-" || !field.IsExported() {
			panic(fmt.Sprintf("tool argument %s requires a public JSON field", field.Name))
		}
		property := argumentProperty(field.Type)
		if text := field.Tag.Get("description"); text != "" {
			property["description"] = text
		}
		if text := field.Tag.Get("itemDescription"); text != "" {
			property["items"].(map[string]any)["description"] = text
		}
		if values := field.Tag.Get("enum"); values != "" {
			property["enum"] = strings.Split(values, ",")
		}
		for _, key := range []string{"minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength"} {
			if text := field.Tag.Get(key); text != "" {
				value, err := strconv.ParseFloat(text, 64)
				if err != nil {
					panic(fmt.Sprintf("invalid %s tag on %s", key, field.Name))
				}
				property[key] = value
			}
		}
		properties[parts[0]] = property
		if len(parts) < 2 || parts[1] != "omitempty" {
			required = append(required, parts[0])
		}
	}
	raw, err := json.Marshal(map[string]any{
		"type": "object", "properties": properties, "required": required, "additionalProperties": false,
	})
	if err != nil {
		panic(err)
	}
	return raw
}

func argumentProperty(typ reflect.Type) map[string]any {
	if typ.Kind() == reflect.Pointer {
		typ = typ.Elem()
	}
	switch typ.Kind() {
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Int, reflect.Int32, reflect.Int64:
		return map[string]any{"type": "integer"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Slice:
		return map[string]any{"type": "array", "items": argumentProperty(typ.Elem())}
	default:
		panic(fmt.Sprintf("unsupported tool argument type: %s", typ))
	}
}
