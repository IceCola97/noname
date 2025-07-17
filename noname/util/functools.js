import { Player } from "../library/element/player.js";
import { GeneratorFunction, AsyncFunction, AsyncGeneratorFunction } from "../util/index.js";
import security from "../util/security.js";

/**
 * @typedef {{
 *     id: number;
 *     source: Function;
 *     isCached(players: Player | Player[]): boolean;
 *     addCachedPlayer(player: Player): void;
 *     removeCachedPlayer(player: Player): void;
 * }} CachingInfo
 */

/** @type {{ [id: number]: WeakRef<CachingInfo> }} */
const cachingIdFunctionMap = {};
/** @type {WeakMap<Function, CachingInfo>} */
const markedCachingFunctions = new WeakMap();
/** @type {WeakMap<Player, WeakSet<CachingInfo>>} */
const playerCachingMap = new WeakMap();
/** @type {number} */
let nextCachingId = Math.trunc(Math.random() * 10000);

/** @type {{ [id: number]: Function }} */
const cachedFunctions = {};

/**
 * 判断当前函数是否对特定玩家缓存过
 * 
 * @this CachingInfo
 * @param {Player|Player[]} players 
 * @returns {boolean}
 */
function isCached(players) {
	if (players instanceof Player) {
		return !!playerCachingMap.get(players)?.has(this);
	} else if (Array.isArray(players)) {
		for (const player of players) {
			if (!playerCachingMap.get(player)?.has(this)) {
				return false;
			}
		}
		return true;
	} else {
		throw new Error("参数 players 不是玩家或玩家数组");
	}
}

/**
 * 标记特定玩家已经缓存过当前函数
 * 
 * @this CachingInfo
 * @param {Player} player 
 */
function addCachedPlayer(player) {
	if (!(player instanceof Player)) {
		throw new Error("参数 player 不是玩家");
	}

	let cached = playerCachingMap.get(player);

	if (!cached) {
		cached = new WeakSet();
		playerCachingMap.set(player, cached);
	}

	cached.add(this);
}

/**
 * 取消标记特定玩家已经缓存过当前函数
 * 
 * @this CachingInfo
 * @param {Player} player 
 */
function removeCachedPlayer(player) {
	if (!(player instanceof Player)) {
		throw new Error("参数 player 不是玩家");
	}

	playerCachingMap.get(player)?.delete(this);
}

/**
 * 为当前函数创建缓存信息对象
 * 
 * @param {Function} func 
 * @returns {CachingInfo}
 */
function createCachingInfo(func) {
	if (typeof func !== "function") {
		throw new Error("参数 func 不是函数");
	}

	const nextId = nextCachingId;

	if (nextId >= Number.MAX_SAFE_INTEGER) {
		throw new Error("缓存ID已经分配到极限喵");
	}

	nextCachingId++;

	const info = Object.create(null);
	info.id = nextId;
	info.source = func;
	info.isCached = isCached;
	info.addCachedPlayer = addCachedPlayer;
	info.removeCachedPlayer = removeCachedPlayer;
	return Object.freeze(info);
}

export default class FuncTools {
	/** @type {RegExp} */
	static #specialHeadPattern = /^(?:async\b)?\s*[\w$]+\s*=>/;
	/** @type {RegExp} */
	static #functionHeadPattern = /^(?:async\b\s*)?(?:function\b\s*)?(?:\*\s*)?([\w$]+\s*)?\(/;
	/** @type {RegExp} */
	static #illegalFunctionHeadPattern = /^(?:async\b\s*)?\*\s*\(/;
	/** @type {RegExp} */
	static #functionNeckPattern = /^\)\s*(?:=>\s*\{|=>|\{)/;
	/** @type {RegExp} */
	static #identifierPattern = /\b[\w$]+\b/;
	/** @type {RegExp} */
	static #asyncHeadPattern = /^async[\s*(]/;
	/**
	 * ```plain
	 * 测试一段代码是否为函数参数列表
	 * ```
	 *
	 * @param {string} paramstr
	 * @returns { boolean }
	 */
	static isFunctionParam(paramstr) {
		if (paramstr.length == 0) {
			return true;
		}
		// 如果可以我们在盒子里面执行这段代码喵
		// 确保安全哦喵
		const canCreateFunction = security.isSandboxRequired() && security.importSandbox().Marshal.canCreateFunction;
		if (canCreateFunction) {
			return canCreateFunction(paramstr, "");
		}
		try {
			new Function(paramstr, "");
			return true;
		} catch (e) {
			return false;
		}
	}
	/**
	 * ```plain
	 * 测试一段代码是否为函数体
	 * ```
	 *
	 * @typedef {"async"|"generator"|"agenerator"|"any"|null} FunctionType
	 *
	 * @param {string} code
	 * @param {FunctionType} type
	 * @returns {boolean}
	 */
	static isFunctionBody(code, type = /* (function(){return null})() */ null) {
		const canCreateFunction = security.isSandboxRequired() && security.importSandbox().Marshal.canCreateFunction;
		if (canCreateFunction) {
			return canCreateFunction("", code, type);
		}
		if (type == "any") {
			return (
				["async", "generator", "agenerator", null]
					// @ts-expect-error ignore // 突然发现ts-ignore也挺方便的喵
					.some(t => FuncTools.isFunctionBody(code, t))
			);
		}
		try {
			switch (type) {
				default:
					new Function(code);
					break;
				case "generator":
					new GeneratorFunction(code);
					break;
				case "async":
					new AsyncFunction(code);
					break;
				case "agenerator":
					new AsyncGeneratorFunction(code);
					break;
			}
		} catch (e) {
			return false;
		}
		return true;
	}
	
	/**
	 * ```plain
	 * 清洗函数体代码
	 * ```
	 *
	 * @param {string} str
	 * @param {boolean} log
	 * @returns {string}
	 */
	static cleanFuncStr(str, log = false) {
		const emptyFunction = "function () {}";
		str = str.trim();
		// 对于特殊的箭头函数特殊处理: identifier => ...
		const specialMatch = FuncTools.#specialHeadPattern.exec(str);
		if (specialMatch) {
			let body = str.slice(specialMatch[0].length).trim();
			if (body.startsWith("{") && body.endsWith("}")) {
				body = body.slice(1, -1);
			} else {
				body = `return ${body}`;
			}
			if (!FuncTools.isFunctionBody(body, "any")) {
				if (log) {
					console.warn("发现无法识别的远程代码:", str);
				}
				return emptyFunction;
			}
			return `${specialMatch[0]}{${body}}`;
		}
		// 匹配函数头
		const functionHead = FuncTools.#functionHeadPattern.exec(str);
		if (!functionHead) {
			if (log) {
				console.warn("发现无法识别的远程代码:", str);
			}
			return emptyFunction;
		}
		// 检查非法函数头
		if (FuncTools.#illegalFunctionHeadPattern.test(functionHead[0])) {
			if (log) {
				console.warn("发现无法识别的远程代码:", str);
			}
			return emptyFunction;
		}
		// 遍历字符串来寻找参数列表的关闭括号
		const headLen = functionHead[0].length;
		let start = headLen;
		let foundClose;
		let verifiedParams = null;
		while ((foundClose = str.indexOf(")", start)) >= 0) {
			const tempParams = str.slice(headLen, foundClose);
			// 检查收集到的参数列表是否是有效的
			if (FuncTools.isFunctionParam(tempParams)) {
				verifiedParams = tempParams;
				break;
			}
			start = foundClose + 1;
		}
		if (verifiedParams == null) {
			if (log) {
				console.warn("发现无法识别的远程代码:", str);
			}
			return emptyFunction;
		}
		// 检查函数连接
		const neckStart = str.slice(foundClose);
		const neckMatch = FuncTools.#functionNeckPattern.exec(neckStart);
		if (!neckMatch) {
			if (log) {
				console.warn("发现无法识别的远程代码:", str);
			}
			return emptyFunction;
		}
		// 箭头函数分流检查
		if (neckMatch[0].includes("=>")) {
			let funcHead = functionHead[0];
			let idMatch;
			while ((idMatch = FuncTools.#identifierPattern.exec(funcHead))) {
				if (idMatch[0] != "async") {
					if (log) {
						console.warn("发现无法识别的远程代码:", str);
					}
					return emptyFunction;
				}
				funcHead = funcHead.slice(idMatch.index + idMatch[0].length);
			}
		} else {
			let funcHead = functionHead[0];
			let idMatch;
			while ((idMatch = FuncTools.#identifierPattern.exec(funcHead))) {
				if (idMatch[0] != "async") {
					break;
				}
				funcHead = funcHead.slice(idMatch.index + idMatch[0].length);
			}
			if (!idMatch) {
				if (log) {
					console.warn("发现无法识别的远程代码:", str);
				}
				return emptyFunction;
			}
		}
		// 块类型分流
		const isBlock = neckMatch[0].endsWith("{");
		let funcBody;
		if (isBlock) {
			if (!str.endsWith("}")) {
				if (log) {
					console.warn("发现无法识别的远程代码:", str);
				}
				return emptyFunction;
			}
			funcBody = "{" + str.slice(foundClose + neckMatch[0].length);
		} else {
			// 将表达式函数体转换成块函数体
			funcBody = `{ return ${str.slice(foundClose + neckMatch[0].length).trim()}; }`;
		}
		// 收集函数类型
		let funcType = 0;
		if (functionHead[0].includes("*")) {
			funcType |= 1;
		}
		if (FuncTools.#asyncHeadPattern.test(functionHead[0])) {
			funcType |= 2;
		}
		// 检查函数体
		const checkType = [null, "generator", "async", "agenerator"][funcType];
		// @ts-expect-error ignore
		if (!FuncTools.isFunctionBody(funcBody, checkType)) {
			if (log) {
				console.warn("发现无法识别的远程代码:", str);
			}
			return emptyFunction;
		}
		// 开始构造最终的函数
		let finalStr = ` (${verifiedParams}) ${funcBody}`;
		if (funcType & 1) {
			finalStr = "*" + finalStr;
		}
		finalStr = "function" + finalStr;
		if (funcType & 2) {
			finalStr = "async " + finalStr;
		}
		return finalStr;
	}
	/**
	 * ```plain
	 * 向一段函数代码字符串注入缓存序列ID
	 * 
	 * 对于受支持的客户端应该使用@see {FuncTools.takeCachingId} 来提取对应的ID并执行缓存
	 * ```
	 * 
	 * @param {string} funcStr 
	 * @param {number} id 
	 * @returns {string}
	 */
	static injectCachingId(funcStr, id) {
		// AI提示喵
		// 匹配函数头，并将原函数名替换为`\$CACHING_FUNCTION_\$${id}`
		// 请注意函数头可能包含async、*等额外标记，不能丢失
		return funcStr.replace(FuncTools.#functionHeadPattern, (match, funcName) => {
			return `${match.replace(funcName, `\$CACHING_FUNCTION_\$${id}`)}`;
		});
	}
	/**
	 * ```plain
	 * 从一段函数代码字符串中提取缓存序列ID
	 * ```
	 * 
	 * @param {string} funcStr 
	 * @returns {number|null}
	 */
	static takeCachingId(funcStr) {
		// AI提示喵
		// 请从参数funcStr中匹配函数头，然后将函数头中的函数名称提取出来
		// 最后需要检查函数名称是否符合`\$CACHING_FUNCTION_\$${id}`格式，并将id作为返回值返回
		const match = FuncTools.#functionHeadPattern.exec(funcStr);

		if (match) {
			const funcName = match[1];

			if (funcName.startsWith("\$CACHING_FUNCTION_\$")) {
				const id = funcName.slice(19);

				if (/^\d+$/.test(id)) {
					return parseInt(id) || null;
				}
			}
		}

		return null;
	}
	/**
	 * 如果函数被标记为可缓存函数，返回此函数缓存的管理对象，否则返回null
	 * 
	 * @param {Function|number} func 
	 * @returns {CachingInfo|null}
	 */
	static getCachingFunctionInfo(func) {
		if (typeof func == "number") {
			return cachingIdFunctionMap[func]?.deref() || null;
		} else if (typeof func == "function") {
			return markedCachingFunctions.get(func) || null;
		} else {
			throw new TypeError("参数 func 必须是function或者number");
		}
	}
	/**
	 * 标记函数为可缓存函数并为其分配缓存ID
	 * 
	 * @param {Function} func 
	 */
	static markAsCachingFunction(func) {
		const info = createCachingInfo(func);
		cachingIdFunctionMap[info.id] = new WeakRef(info);
		markedCachingFunctions.set(func, info);
	}
    /**
     * 清除一个玩家的所有缓存记录项
     * 
     * @param {Player} player 
     */
    static clearCachingFunctions(player) {
        playerCachingMap.delete(player);
	}
	/**
	 * 缓存函数并绑定对应ID
	 * 
	 * @param {number} id 
	 * @param {Function} func 
	 * @returns {boolean}
	 */
	static cacheFunction(id, func) { 
		if (typeof id !== "number") {
			throw new TypeError("参数 id 必须为数字");
		}
		if (typeof func !== "function") {
			throw new TypeError("参数 func 必须为函数");
		}
		if (id in cachedFunctions) {
			return false;
		}
		cachedFunctions[id] = func;
		return true;
	}
	/**
	 * 通过缓存ID获取缓存的函数
	 * 
	 * @param {number} id
	 * @returns {Function|null}
	 */
	static getCachedFunction(id) { 
		if (typeof id !== "number") {
			throw new TypeError("参数 id 必须为数字");
		}
		return cachedFunctions[id] || null;
	}
}
