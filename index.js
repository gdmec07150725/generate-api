/**
 * api 生成工具
 */

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const swaggerParser = require("swagger-parser");
const beautify = require("js-beautify").js_beautify; // 用于美化生成的代码

// 获取请求参数的key
const requestBodyKey = "requestBody";
// 获取响应实体的key
const responseSuccessKey = "200";
const successDtoSchemasKey = "application/json";

// 生成的api文件存放目录, 存放到当前目录，可以自行修改
const API_PATH = path.resolve(__dirname, "./");

let swaggerUrl, // swagger json 地址
  inputModuleName, // 要生成api的模块名称， allapi全部生成
  dtoSchemas, // 存储json返回的全部dto实体
  dtoSchemasMap = new Map(), // 存储全部接口使用到的dto实体
  curModuleFileName = ""; // 当前模块名称

// 使用readline读取输入输出流
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/// 输入swagger json 地址
const questionSwaggerJsonUrl = () => {
  return new Promise((resove, reject) => {
    rl.question("Input swagger json url: ", (answer) => {
      if (answer) {
        resove(answer);
      } else {
        reject();
      }
    });
  });
};

/// 输入指定API模块名称
const questionModuleName = () => {
  return new Promise((resolve, reject) => {
    rl.question("Input module name: ", (answer) => {
      if (answer) {
        resolve(answer);
      } else {
        reject();
      }
    });
  });
};

/// 如果是allapi需要二次确认（接口多的话，生成会比较慢，建议每次只生成一个模块的接口）
const ConfirmModuleName = () => {
  return new Promise((resolve, reject) => {
    rl.question("Confirm All Api?(y/n)：", (answer) => {
      resolve(answer);
    });
  });
};

/// 后台字段类型与前端类型的映射
const dataType = (key) => {
  const type = {
    string: "String",
    integer: "number",
    int: "number",
    long: "string",
    Array: "array",
    file: "Blob",
    boolean: "boolean",
  };
  // 没有匹配上的，直接返回any类型(万能的any大法)
  return type[key] ? type[key] : "any";
};

/// 获取api的tags数据
const getApiTags = (data) => {
  const keys = Object.keys(data);
  const method = keys[0];
  return data[method].tags;
};

/// 获取query的参数数组
const getQuery = () => {
  let ary = data.filter((d) => d.in === "query").map((d) => d.name);
  return ary;
};

/// 生成接口方法名称
const getRequestName = (requestUrl) => {
  let filters = ["api", "app", "identity"]; // 过滤掉一部分前缀
  let requestName = requestUrl
    .split("/")
    .filter((d) => {
      return d && !filters.includes(d);
    })
    .map((d) => transUpperName(d))
    .join("");
  // 去掉模块名称，防止生成的接口方法名太长
  const returnReqName =
    requestName.replace(curModuleFileName, "") || curModuleFileName;
  return returnReqName;
};

// 横杠连接的名称转换成首字母大写格式
const transUpperName = (name) => {
  name = name.split("{").join("").split("}").join(""); // 消除{}符号
  let arr = name.split("-");
  if (arr.length === 1) {
    //首字母变大写
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return arr
    .map((d) => {
      return d.charAt(0).toUpperCase() + d.slice(1);
    })
    .join("");
};

const replaceKey = (key) => {
    const valueKey = key.replace("#/components/schemas/", "");
    return valueKey;
}

const deletePoint = (name) => {
    if (name) {
        return name.split(".").join("");
    }
}

/// 生成dto类型接口名称
const genDtoInterfaceName = (key) => {
    // 替换一些特殊的符号
    const keyArr = deletePoint(replaceKey(key)).split("`1");
    let dtoInterfaceName = keyArr[0].replace("+", "_");
    if (keyArr[1]) {
        const keyJson = keyArr[1].replace("[[", "").replace("]]", "").split(",")[0];
        dtoInterfaceName += `_${keyJson}`;
    }
    return dtoInterfaceName;
}

const returnFieldType = (key) => {
    if (key) {
        // 如果是enum实体，则返回number类型
        let isEnumDto = !!dtoSchemas[replaceKey(key)]?.["enum"];
        let fieldType = isEnumDto ? "number" : `${genDtoInterfaceName(key)}`;
        return fieldType;
    }
}

/// 匹配字段类型
const matchFieldType = (item) => {
  let fieldType = "",
    dtoKey = "";
  const { type } = item;
  switch (type) {
    case "array": // 实体为数组类型
      const { items = {} } = item;
      if (items?.["$ref"]) {
        dtoKey = items["$ref"];
        fieldType = `${returnFieldType(dtoKey)}[]`;
      } else {
        fieldType = `${dataType(item?.["type"])}[]`;
      }
      break;
    case "Object":
      const { additionalProperties = {} } = item;
      if (additionalProperties?.["$ref"]) {
        dtoKey = additionalProperties["$ref"];
        fieldType = `${returnFieldType(dtoKey)}`;
      } else {
        fieldType = "any";
      }
      break;
    default:
      fieldType = dataType(type);
      break;
  }
  return { fieldType, dtoKey };
};

/// 生成接口请求dto实体key和响应dto实体key
const genDtoSchemasKey = (apiItem, type = "res") => {
  let schemaParams = {};
  let dtoKey = "",
    funReturnType = "any";
  if (type === "res") {
    // 获取响应实体对象
    schemaParams =
      apiItem.responses[responseSuccessKey]?.["content"]?.[
        successDtoSchemasKey
      ]?.["schema"];
  } else {
    // 获取请求实体对象
    schemaParams =
      apiItem[requestBodyKey]?.["content"]?.[successDtoSchemasKey]?.["schema"];
  }
  if (schemaParams?.type) {
    const matchFieldVal = matchFieldType(schemaParams);
    funReturnType = matchFieldVal["fieldType"];
    dtoKey = matchFieldVal["dtoKey"];
  } else if (schemaParams?.["$ref"]) {
    dtoKey = schemaParams["$ref"];
    funReturnType = returnFieldType(dtoKey);
  }
  return { dtoKey, funReturnType };
};

// 保存使用到的dto实体
const saveDtoSchemas = (dtoKey) => {
    if (dtoKey && !dtoSchemasMap.has(dtoKey)) {
        dtoSchemasMap.set(dtoKey, dtoSchemas[replaceKey(dtoKey)]);
    }
}

// 生成api方法和请求实体
const genApiAndRequestDto = (apiInfo) => {
  const keys = Object.keys(apiInfo);
  let tplCode = ``;
  for (let method of keys) {
    if (method === "fullPath") {
      continue;
    }

    const methodParams = apiInfo[method]; // 每一个接口对应的请求方式对象（get, post, put, delete)
    const parameters = methodParams.parameters || []; // 获取接口需要提交的参数数组
    let fullPath = apiInfo.fullPath; // 接口路径
    const requestName = getRequestName(fullPath); // 获取方法名
    let interfaceName = "any";
    let interfaceParams = ""; // url参数
    let interfaceBody = "";
    // query的参数数组（api地址上要携带的查询字符串参数）
    let query = [];
    if (parameters.length > 0) {
      interfaceName = `${requestName}${transUpperName(method)}Itf`;
      interfaceParams = `params: ${interfaceName}`;
      query = getQuery(parameters);
    }

    const { dtoKey: reqDtoKey, funReturnType: apiReqType } = genDtoSchemasKey(
      methodParams,
      "req"
    );
    if (apiReqType && apiReqType !== "any") {
      interfaceBody = `data: ${apiReqType}`;
    }
    const { dtoKey: resDtoKey, funReturnType: apiResType } = genDtoSchemasKey(
      methodParams,
      "res"
    );

    saveDtoSchemas(reqDtoKey);
    saveDtoSchemas(resDtoKey);
    
    // 替换URl上的参数
    if (fullPath.indexOf("{") !== -1) {
        fullPath = fullPath.replace(/{/g, "${params.");
    }

    tplCode +=  `${methodParams.summary ? `/**
      * @description ${methodParams.summary}
    */` : ""}
        ${interfaceParamsTpl(parameters, interfaceName)}
        export async function ${requestName}${transUpperName(method)}`;
    
    if (method.toLowerCase() === "get") {
        tplCode += `(${interfaceParams}): Promise<${apiResType}> {
            const path: string = ${(query.length > 0) && interfaceParams ? `genQueryPath(params, ${JSON.stringify(query)}, \`${fullPath}\`)` : `\`${fullPath}\``};
            return http.${method}(path);
        }\n`;
    } else { // 除get以外的请求
        tplCode += `(${interfaceParams ? `${interfaceParams},`: ""} ${interfaceBody}): Promise<${apiResType}> {
            const path: string = ${!!query.length ? `genQueryPath(params, ${JSON.stringify(query)}, \`${fullPath}\`)` : `\`${fullPath}\``};
            return http.${method}(path, ${interfaceBody ? ", data": ""});
        }\n`;
    }
  }
  return tplCode;
};

// 生成dto类型声明
const genDtoSchemas = () => {
    let tplField, tplFieldType, tplCode, dtoKey = "";
    dtoSchemasMap.forEach((dtoSchemaValue, key) => {
        const { type, properties = {} } = dtoSchemaValue;
        if (type === "object") {
            for (let k in properties) {
                const { $ref, nullable } = properties[k];
                if ($ref) {
                    tplFieldType = returnFieldType($ref);
                    dtoKey = $ref;
                } else {
                    const matchFieldVal = matchFieldType(properties[k]);
                    tplFieldType = matchFieldVal["fieldType"];
                    dtoKey = matchFieldVal["dtoKey"];
                }
                saveDtoSchemas(dtoKey);
                tplField += `${k}${nullable ? "?" : ""} : ${tplFieldType}`;
            }
            tplCode += `export interface ${genDtoInterfaceName(key)} {
                ${tplField}
            }\n\n`;
        }
        tplField = ``; // 每次循环结束，清空字段模板
    });
    return tplCode;
}

const writeFileAPi = (apiData, tags) => {
  let tplIndex = `import { genQueryPath } from './utils'; \n import { http } from @/utils/request`;
  let tplDtoSchemas = `/**dto类型声明**/`;
  const apiDataLen = apiData.length;
  for (let i = 0; i < apiDataLen; i++) {
    const pathItem = apiData[i];
    curModuleFileName = getApiTags(item)[0]; // 使用tags作为文件命名
    tplIndex = `${tplIndex}\n${genApiAndRequestDto(pathItem)}\n`;
  }
  // 生成Dto类型声明
  tplDtoSchemas = `${tplDtoSchemas}\n${genDtoSchemas}\n`;

  tplIndex = tplIndex + tplDtoSchemas;
  // 美化生成的代码
  tplIndex = beautify(tplIndex, { indent_size: 2, max_preserve_newlines: 2 });
  
  // 输入文件
  fs.writeFileSync(`${API_PATH}/${curModuleFileName}.tsx`, tplIndex);
};

const gen = (moduleMap, tags) => {
  moduleMap.forEach((value, key) => {
    writeFileAPi(value, tags);
    // 生成完一个模块需要清空该模块使用到底额dto实体
    dtoSchemasMap.clear();
  });
  console.log(`Complete`);
  rl.close();
};

const init = async () => {
  try {
    // 使用swagger-parser解析url获取api的json数据
    const parsed = await swaggerParser.parse(swaggerUrl, null, {
      resolve: {
        http: {
          timeout: 30 * 1000, // 设置请求超时时间
        },
      },
    });
    console.log("parsed", parsed);
    const allPaths = parsed.paths; // 所有的api数据，键值对形式（key为api的路径，value为api的描述对象）
    const tags = parsed.tags || []; // 接口模块的命名和描述汇总
    dtoSchemas = parsed.components.schemas; // json返回的全部dto实体

    const pathskeys = Object.keys(paths); // 获取url路径
    const pathsKeysLen = pathskeys.length;
    const modulesMap = new Map();

    for (let i = 0; i < pathsKeysLen; i++) {
      const pathKey = pathskeys[i];
      const pathItem = allPaths[pathKey];
      let fileName = getApiTags(pathItem)[0];
      if (!fileName) continue;
      fileName = fileName.toLowerCase();
      // 如果不是输出所有api，则需要筛选出指定输入的模块的api
      const lowerInputModuleName = inputModuleName.toLowerCase();
      if (
        lowerInputModuleName !== "allapi" &&
        fileName !== lowerInputModuleName
      ) {
        continue;
      }
      // 写入完整路径
      pathItem.fullPath = pathKey;
      if (modulesMap.has(fileName)) {
        const fileNameAry = modulesMap.get(fileName);
        fileNameAry.push(pathItem);
        modulesMap.set(fileName, fileNameAry);
      } else {
        modulesMap.set(fileName, [pathItem]);
      }
    }
    // 找不到指定模块内容
    if (Array.from(modulesMap).length === 0) {
      console.log(`[${inputModuleName}] not found`);
      rl.close();
      return;
    }
    gen(modulesMap, tags);
  } catch (err) {
    console.error(err);
  }
};

/// 命令行询问事务
(async () => {
  swaggerUrl = await questionSwaggerJsonUrl().catch((err) => {});
  if (!swaggerUrl) {
    console.log("has not swagger json url");
    rl.close();
    return;
  }
  inputModuleName = await questionModuleName().catch((err) => {});
  if (!inputModuleName) {
    console.log("has not module name");
    rl.close();
    return;
  }
  if (inputModuleName.toLowerCase() === "allapi") {
    let confirm = await ConfirmModuleName();
    if (confirm === "n") {
      console.log("cancel All Api");
      rl.close();
      return;
    }
  }
  console.log(`wait a moment [${inputModuleName}]...`);
  init();
})();
