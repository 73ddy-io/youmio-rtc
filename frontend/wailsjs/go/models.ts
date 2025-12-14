export namespace main {
	
	export class AgentConfig {
	    id: string;
	    token: string;
	
	    static createFrom(source: any = {}) {
	        return new AgentConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.token = source["token"];
	    }
	}

}

