import { lib } from "../library/index.js";
import { game } from "../game/index.js";
import { ui } from "../ui/index.js";
import { get } from "../get/index.js";
import { Card } from "../library/element/card.js";
import { Player } from "../library/element/player.js";
import { GameEvent } from "../library/element/gameEvent.js";
import { VCard } from "../library/element/vcard.js";
import security from "./security.js";
import FuncTools from "./functools.js";
import { CodeSnippet, ErrorManager } from "./error.js";

// 用于标识Map、Set等对象在序列化中的类型
// 使用了md5("__noname_type")的值作为键
// 尽可能减少碰撞喵（应该不会碰撞的吧）
/** @typedef */
const TYPE_KEY = "a60e024487f63a67c634d782aaaf1127";

/**
 * 反编译函数为源代码的函数
 * 
 *  @type {(func: Function) => string} 
 */
const decompileFunction = security.isSandboxRequired() ? security.importSandbox().Marshal.decompileFunction : Function.prototype.call.bind(Function.prototype.toString);

export default class Serialization {
	/**
	 * 序列化卡牌信息
	 * 
	 * @param {Card} card 
	 * @returns {string}
	 */
	static serializeCard(card) {
		return "_noname_card:" + JSON.stringify([card.cardid, card.suit, card.number, card.name, card.nature]);
	}
	/**
	 * 反序列化卡牌信息
	 * 
	 * @param {string} info 
	 * @returns {Card}
	 */
	static deserializeCard(info) {
		if (!("cardOL" in lib) || !lib.cardOL) {
			throw new ReferenceError("不应该在非联机模式下使用此函数");
		}

		try {
			const data = JSON.parse(info.slice(13));
			const cardid = data.shift();

			if (!cardid) {
				const card = ui.create.card();
				if (data?.[2]) {
					card.init(data);
				}
				return card;
			} else if (lib.cardOL[cardid]) {
				const card = lib.cardOL[cardid];
				if (data?.[2] && card.name != data?.[2]) {
					card.init(info);
				}
				return card;
			} else if (game.online) {
				const card = ui.create.card();
				card.cardid = cardid;
				if (data?.[2]) {
					card.init(data);
				}
				lib.cardOL[cardid] = card;
				return card;
			}

			const card = ui.create.card();
			card.init(data);
			return card;
		} catch (e) {
			console.log(e);
			return ui.create.card();
		}
	}
	/**
	 * 序列化牌数组信息
	 * 
	 * @template T
	 * @param {Card[]} cards 
	 * @returns {string[]}
	 */
	static serializeCards(cards) {
		return Array.from(cards || []).map(Serialization.serializeCard);
	}
	/**
	 * 反序列化牌数组信息
	 * 
	 * @param {string[]} infos 
	 * @returns {Card[]}
	 */
	static deserializeCards(infos) {
		return Array.from(infos || []).map(Serialization.deserializeCard);
	}
	/**
	 * 序列化玩家信息
	 * 
	 * @param {Player} player 
	 * @returns {string}
	 */
	static serializePlayer(player) {
		return "_noname_player:" + player.playerid;
	}
	/**
	 * 反序列化玩家信息
	 * 
	 * @param {string} info 
	 * @returns {Player}
	 */
	static deserializePlayer(info) {
		if (!("playerOL" in lib) || !lib.playerOL) {
			throw new ReferenceError("不应该在非联机模式下使用此函数");
		}

		const player = lib.playerOL[info.slice(15)];

		if (!player) {
			throw new ReferenceError("玩家不存在");
		}

		return player;
	}
	/**
	 * 序列化玩家数组信息
	 * 
	 * @param {Player[]} players 
	 * @returns {string[]}
	 */
	static serializePlayers(players) {
		return Array.from(players || []).map(Serialization.serializePlayer);
	}
	/**
	 * 反序列化玩家数组信息
	 * 
	 * @param {string[]} infos 
	 * @returns {Player[]}
	 */
	static deserializePlayers(infos) {
		return Array.from(infos || []).map(Serialization.deserializePlayer);
	}
	/**
	 * 序列化函数信息
	 * 
	 * @param {Function} func 
	 * @returns {string}
	 */
	static serializeFunction(func) {
		if (typeof func == "function") {
			if ("_filter_args" in func && func._filter_args) {
				return "_noname_func:" + JSON.stringify(Serialization.serialize(func._filter_args, 3));
			}
			// 沙盒在封装函数时，为了保存源代码会另外存储函数的源代码
			const str = decompileFunction(func);
			// js内置的函数
			if (/\{\s*\[native code\]\s*\}\s*$/.test(str)) {
				return "_noname_func:function () {}";
			}
			return "_noname_func:" + FuncTools.cleanFuncStr(str);
		}
		return "_noname_func:function () {}";
	}
	/**
	 * 反序列化函数信息
	 * 
	 * @param {string} info 
	 * @returns {Function}
	 */
	static deserializeFunction(info) {
		if ("sandbox" in window) {
			console.log("[deserializeFunction] info:", info);
		}

		const str = FuncTools.cleanFuncStr(info.slice(13), true); // 清洗函数并阻止注入
		if ("sandbox" in window) {
			console.log("[deserializeFunction] cleaned:", str);
		}

		/** @type {Function} */
		let func;

		try {
			// js内置的函数
			if (/\{\s*\[native code\]\s*\}/.test(str)) {
				return function () {};
			}
			if (security.isSandboxRequired()) {
				const loadStr = `return (${str});`;
				const box = security.currentSandbox();
				if (!box) {
					throw new ReferenceError("没有找到当前沙盒");
				}
				func = box.exec(loadStr);
				ErrorManager.setCodeSnippet(func, new CodeSnippet(str, 5));
			} else {
				func = security.exec(`return (${str});`);
				ErrorManager.setCodeSnippet(func, new CodeSnippet(str, 3));
			}
		} catch (e) {
			console.error(`[deserializeFunction] 反序列化函数失败喵 ${str}`, e);
			return function () {};
		}

		if (Array.isArray(func)) {
			// @ts-expect-error 反正能跑喵（应该吧喵）
			func = get.filter.apply(this, Serialization.deserialize(func));
		}

		return func;
	}
	/**
	 * 序列化游戏事件信息
	 * 
	 * @param {GameEvent} item 
	 * @param {boolean | undefined} [noMore=true] 
	 * @returns {string}
	 */
	static serializeEvent(item, noMore = true) {
		return get.itemtype(item) == "event"
			? `_noname_event:${JSON.stringify(
					Object.entries(item).reduce((stringifying, entry) => {
						const key = entry[0];
						if (key == "_trigger") {
							if (noMore !== false) {
								stringifying[key] = Serialization.serializeEvent(entry[1], false);
							}
						} else if (!lib.element.GameEvent.prototype[key] && key != "content" && get.itemtype(entry[1]) != "event") {
							stringifying[key] = Serialization.serialize(entry[1], null, false);
						}
						return stringifying;
					}, {})
				)}`
			: "";
	}
	/**
	 * 反序列化游戏事件信息
	 * 
	 * @param {string} item
	 * @returns {GameEvent}
	 */
	static deserializeEvent(item) {
		const evt = new lib.element.GameEvent();

		try {
			Object.entries(JSON.parse(item.slice(14))).forEach(entry => {
				const key = entry[0];
				if (typeof evt[key] != "function") {
					evt[key] = Serialization.deserialize(entry[1]);
				}
			});
		} catch (e) {
			console.error(`[deserializeEvent] 反序列化事件失败喵`, e);
		}

		return evt;
	}
	/**
	 * 序列化虚拟牌的信息
	 * 
	 * @param {VCard} vcard 
	 * @returns {string}
	 */
	static serializeVCard(vcard) {
		return (
			"_noname_vcard:" +
			JSON.stringify(
				Object.entries(vcard).reduce((stringifying, entry) => {
					const key = entry[0];
					stringifying[key] = Serialization.serialize(entry[1]);
					return stringifying;
				}, {})
			)
		);
	}
	/**
	 * 反序列化虚拟牌的信息
	 * 
	 * @param {string} item 
	 * @returns {VCard}
	 */
	static deserializeVCard(item) {
		if (!("vcardOL" in lib) || !lib.vcardOL || typeof lib.vcardOL !== "object") {
			throw new ReferenceError("不应该在非联机模式下使用此函数");
		}
		
		const rawCard = JSON.parse(item.slice(14));
		const data = Object.entries(rawCard).reduce((vcard, entry) => {
			const key = entry[0];
			vcard[key] = Serialization.deserialize(entry[1]);
			return vcard;
		}, {});

		/** @type {number} */
		const vid = "vcardID" in data ? Number(data.vcardID) : 0;
		
		if (!vid || !lib.vcardOL) {
			return new lib.element.VCard(data);
		}
		
		if (vid in lib.vcardOL) {
			const vcard = lib.vcardOL[vid];
			// TODO: 这里暂时偷懒 直接用了delete和直接赋值 不妥
			// 但是苏婆喵到现在也还没有重写这里哦喵
			Object.keys(vcard).forEach(entry => {
				delete vcard[entry];
			});
			Object.keys(data).forEach(key => {
				const value = data[key];
				if (Array.isArray(value)) {
					vcard[key] = value.slice();
				}
				vcard[key] = value;
			});
			return vcard;
		} else {
			const vcard = new lib.element.VCard(data);
			lib.vcardOL[vid] = vcard;
			return vcard;
		}
	}
	/**
	 * 序列化虚拟牌数组信息
	 * 
	 * @param {VCard[]} cards 
	 * @returns {string[]}
	 */
	static serializeVCards(cards) {
		return Array.from(cards || []).map(Serialization.serializeVCard);
	}
	/**
	 * 反序列化虚拟牌数组信息
	 * 
	 * 
	 * @param {string[]} infos 
	 * @returns {VCard[]}
	 */
	static deserializeVCards(infos) {
		return Array.from(infos || []).map(Serialization.deserializeVCard);
	}
	/**
	 * 序列化Map信息
	 * 
	 * @param {Map} map 要序列化的Map
	 * @param {number|null} [level] 最大的序列化嵌套层级
	 * @param {boolean|null} [nomore=true] 传递false取消内部事件的序列化
	 * @returns {{ [index: number]: any; [TYPE_KEY]: "map"; }}
	 */
	static serializeMap(map, level=null, nomore=true) {
		/** @type {{ [index: number]: any; [TYPE_KEY]: "map"; }} */
		const info = { [TYPE_KEY]: "map" };

		for (const [key, value] of map.entries()) {
			Array.prototype.push.call(info, [
				Serialization.serialize(key, level, nomore),
				Serialization.serialize(value, level, nomore),
			]);
		}

		return info;
	}
	/**
	 * 反序列化Map信息
	 * 
	 * @param {{ [index: number]: any; [TYPE_KEY]: "map"; }} item 
	 * @returns {Map}
	 */
	static deserializeMap(item) {
		const map = new Map();

		for (const index in item) {
			if (!isFinite(Number(index))) {
				break;
			}

			const pair = item[index];

			if (!Array.isArray(pair) || pair.length !== 2) {
				continue;
			}

			map.set(
				Serialization.deserialize(pair[0]),
				Serialization.deserialize(pair[1])
			);
		}

		return map;
	}
	/**
	 * 序列化Set信息
	 * 
	 * @param {Set} set 要序列化的Set
	 * @param {number|null} [level] 最大的序列化嵌套层级
	 * @param {boolean|null} [nomore=true] 传递false取消内部事件的序列化
	 * @returns {{ [index: number]: any; [TYPE_KEY]: "set"; }}
	 */
	static serializeSet(set, level=null, nomore=true) {
		/** @type {{ [index: number]: any; [TYPE_KEY]: "set"; }} */
		const info = { [TYPE_KEY]: "set" };

		for (const value of set) {
			Array.prototype.push.call(info,
				Serialization.serialize(value, level, nomore));
		}

		return info;
	}
	/**
	 * 反序列化Set信息
	 * 
	 * @param {{ [index: number]: any; [TYPE_KEY]: "set"; }} item 
	 * @returns 
	 */
	static deserializeSet(item) {
		const set = new Set();

		for (const index in item) {
			if (!isFinite(Number(index))) {
				break;
			}

			set.add(Serialization.deserialize(item[index]));
		}

		return set;
	}
	/**
	 * 对给定的玩家、牌、事件以及集合和原始类型进行序列化喵
	 * 此函数不支持对其他的浏览器对象序列化，包括所有的DOM对象喵
	 * 
	 * @param {any} item 
	 * @param {number|null} level 
	 * @param {boolean|null} [nomore=true]
	 * @returns {null|undefined|boolean|number|string|string[]|{}}
	 */
	static serialize(item, level=null, nomore=true) {
		if (!item) {
			return item;
		}
		if (typeof item == "function") {
			return Serialization.serializeFunction(item);
		} else if (typeof item == "object") {
			switch (get.itemtype(item)) {
				case "card":
					return Serialization.serializeCard(item);
				case "cards":
					return Serialization.serializeCards(item);
				case "vcard":
					return Serialization.serializeVCard(item);
				case "vcards":
					return Serialization.serializeVCards(item);
				case "player":
					return Serialization.serializePlayer(item);
				case "players":
					return Serialization.serializePlayers(item);
				case "event":
					if (nomore === false) {
						return "";
					}
					return Serialization.serializeEvent(item);
				default:
					if (typeof level != "number") {
						level = 8;
					}
					if (Array.isArray(item)) {
						if (level == 0) {
							return [];
						}
						const result = [];
						for (let i = 0; i < item.length; i++) {
							result.push(Serialization.serialize(item[i], level - 1, nomore));
						}
						return result;
					} else {
						if (level == 0) {
							console.warn("[serialize] 通过网络发送的对象嵌套层级过多，部分数据将被忽略喵")
							return {};
						}

						const type = Object.prototype.toString.call(item).slice(8, -1);

						switch(type) {
							case "Map":
								return Serialization.serializeMap(item, level - 1, nomore);
							case "Set":
								return Serialization.serializeSet(item, level - 1, nomore);
							case "Object": {
								const result = {};
								for (const i in item) {
									result[i] = Serialization.serialize(item[i], level - 1, nomore);
								}
								return result;
							}
							default:
								if (item instanceof Node) {
									console.warn("[serialize] 尝试通过网络传输DOM节点，但是这是不可能的喵", item);
								}
								return {};
						}
					}
			}
		} else if (item === Infinity) {
			return "_noname_infinity";
		} else {
			return item;
		}
	}
	/**
	 * 将@see {Serialization.serialize} 函数得到的结果解析为原来的对象或者数据
	 * 
	 * @param {null|undefined|boolean|number|string|string[]|{}} item 
	 * @returns {null|undefined|boolean|number|string|Card|Card[]|VCard|VCard[]|Player|Player[]|GameEvent|{}}
	 */
	static deserialize(item) {
		if (!item) {
			return item;
		}
		if (typeof item == "string") {
			if (item.startsWith("_noname_func:")) {
				return Serialization.deserializeFunction(item);
			} else if (item.startsWith("_noname_card:")) {
				return Serialization.deserializeCard(item);
			} else if (item.startsWith("_noname_vcard:")) {
				return Serialization.deserializeVCard(item);
			} else if (item.startsWith("_noname_player:")) {
				return Serialization.deserializePlayer(item);
			} else if (item.startsWith("_noname_event:")) {
				return Serialization.deserializeEvent(item);
			} else if (item == "_noname_infinity") {
				return Infinity;
			} else {
				return item;
			}
		} else if (Array.isArray(item)) {
			const result = [];
			for (let i = 0; i < item.length; i++) {
				result.push(Serialization.deserialize(item[i]));
			}
			return result;
		} else if (typeof item == "object") {
			if (TYPE_KEY in item) {
				switch (item[TYPE_KEY]) {
					case "map":
						// @ts-expect-error 不太智能的ESLint喵
						return Serialization.deserializeMap(item);
					case "set":
						// @ts-expect-error 不太智能的ESLint喵
						return Serialization.deserializeSet(item);
				}
			}
			const result = {};
			for (const i in item) {
				result[i] = Serialization.deserialize(item[i]);
			}
			return result;
		} else {
			return item;
		}
	}
}
